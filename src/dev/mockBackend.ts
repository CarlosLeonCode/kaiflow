/**
 * In-memory stand-in for the Rust backend, installed with Tauri's `mockIPC` in dev and E2E
 * runs (`VITE_MOCK_IPC=1`). It mirrors the contract in `bindings.ts` closely enough to drive
 * the real UI: classification precedence, range clipping, idle gap resolution, validated
 * rules and two-step destructive deletes with single-use tokens.
 */

import { mockIPC } from "@tauri-apps/api/mocks";

import type {
  AppError,
  AppTotalDto,
  ActivityDto,
  ActivityTotalDto,
  FocusDto,
  IdleResolutionDto,
  PermissionStateDto,
  ProductivityDto,
  RangeDto,
  ReportDto,
  RuleDto,
  RuleInputDto,
  SettingsDto,
  SettingsPatchDto,
  SuggestionDto,
  TimelineItemDto,
  TrackingStateDto,
  TrackingStatusDto,
  UpdateInfoDto,
} from "@/shared/ipc";

import { buildDashboard } from "./mockDashboard";
import { matchPreset, mockPresets } from "./mockPresets";
import { buildSeed, type MockData, type MockSegment } from "./seed";

const SYSTEM_ACTIVITY = 1;

export interface MockOptions {
  /** Start with Accessibility revoked (onboarding and the degraded banner). */
  permission?: PermissionStateDto;
  /** The update the server offers. */
  update?: UpdateInfoDto | null;
  /** Announce it at startup (like the daily background check) instead of only on a manual check. */
  announceUpdate?: boolean;
  /** Start with only the system activity and no rules (first-run preset choice). */
  emptyActivities?: boolean;
  /** Start without any tracked time (empty states of Today and Overview). */
  emptyHistory?: boolean;
  now?: () => number;
}

/** Tauri rejects with the raw serialized error: throwing a plain object reproduces that. */
function fail(error: AppError): never {
  throw error;
}

export function classify(segment: MockSegment, rules: readonly RuleDto[]): number {
  if (segment.activity_id !== null) return segment.activity_id;
  const ordered = [...rules].sort((a, b) => b.priority - a.priority || a.id - b.id);
  const title = segment.window_title ?? "";
  for (const rule of ordered) {
    if (rule.spec.kind !== "title_pattern") continue;
    if (rule.spec.app_id !== null && rule.spec.app_id !== segment.app_id) continue;
    if (compilePattern(rule.spec.pattern).test(title)) return rule.activity_id;
  }
  for (const rule of ordered) {
    if (rule.spec.kind === "app" && rule.spec.app_id === segment.app_id) return rule.activity_id;
  }
  return SYSTEM_ACTIVITY;
}

/** The Rust regex crate accepts `(?i)`; JavaScript spells it as a flag. */
function compilePattern(pattern: string): RegExp {
  const insensitive = pattern.startsWith("(?i)");
  return new RegExp(insensitive ? pattern.slice(4) : pattern, insensitive ? "i" : "");
}

export function installMockBackend(options: MockOptions = {}): void {
  const clock = options.now ?? (() => Date.now());
  const data: MockData = buildSeed(clock());
  if (options.emptyActivities) {
    data.activities = data.activities.filter((a) => a.id === SYSTEM_ACTIVITY);
    data.rules = [];
  }
  if (options.emptyHistory) {
    data.segments = [];
    data.gaps = [];
    data.autoDiscarded = [];
  }
  const dismissedSuggestions = new Set<string>();
  let permission: PermissionStateDto = options.permission ?? "granted";
  let tracking: TrackingStateDto = "running";
  let settings: SettingsDto = {
    store_titles: true,
    idle_threshold_secs: 300,
    idle_prompt_timeout_secs: 600,
    idle_auto_discard_below_secs: 120,
    retention_days: null,
    theme: "system",
    autostart: false,
    shortcut: "⌃⌥⌘T",
    onboarding_completed: true,
    tray_display: "today_total",
    ui: { dismissed_intros: [] },
  };
  let tokenCounter = 0;
  const liveTokens = new Set<string>();
  const offeredUpdate = options.update ?? null;

  const open = () => data.segments.find((s) => s.ended_at === null);
  const closeOpen = (reason: MockSegment["end_reason"]) => {
    const current = open();
    if (current) {
      current.ended_at = clock();
      current.end_reason = reason;
    }
  };
  const startSegment = (focus: FocusDto) => {
    data.segments.push({
      id: data.nextIds.segment++,
      started_at: clock(),
      ended_at: null,
      app_id: focus.app_id,
      app_name: focus.app_name,
      window_title: focus.window_title,
      source: "tracked",
      activity_id: null,
      end_reason: null,
    });
  };
  const lastFocus = (): FocusDto | null => {
    const tracked = data.segments.filter((s) => s.source === "tracked" && s.app_id !== null);
    const last = tracked.sort((a, b) => b.started_at - a.started_at)[0];
    return last ? { app_id: last.app_id ?? "", app_name: last.app_name ?? "", window_title: last.window_title } : null;
  };

  const status = (): TrackingStatusDto => {
    const current = open();
    return {
      state: tracking,
      current:
        tracking === "running" && current
          ? { app_id: current.app_id ?? "", app_name: current.app_name ?? "", window_title: current.window_title }
          : null,
      since: tracking === "running" && current ? current.started_at : null,
      degraded: permission === "denied",
      degraded_reason: permission === "denied" ? "accessibility_denied" : null,
      shortcut: { kind: "registered", shortcut: settings.shortcut },
    };
  };

  const clip = (range: RangeDto) =>
    data.segments
      .map((segment) => ({
        segment,
        start: Math.max(segment.started_at, range.from),
        end: Math.min(segment.ended_at ?? clock(), range.to),
      }))
      .filter((part) => part.end > part.start);

  const redact = (segment: MockSegment): string | null =>
    !settings.store_titles || (segment.app_id && data.redacted.includes(segment.app_id)) ? null : segment.window_title;

  const report = (range: RangeDto, buckets: RangeDto[]): ReportDto => {
    const byApp = new Map<string, AppTotalDto>();
    const byActivity = new Map<number, ActivityTotalDto>();
    let total = 0;
    for (const { segment, start, end } of clip(range)) {
      const ms = end - start;
      total += ms;
      const appKey = segment.app_id ?? "";
      const app = byApp.get(appKey) ?? {
        app_id: segment.app_id,
        // Like the backend: manual (app-less) time has an empty app name; the UI labels it.
        app_name: segment.app_name ?? "",
        total_ms: 0,
      };
      app.total_ms += ms;
      byApp.set(appKey, app);
      const activityId = classify(segment, data.rules);
      const activity = data.activities.find((c) => c.id === activityId) ?? data.activities[0];
      if (!activity) continue;
      const row = byActivity.get(activity.id) ?? {
        activity_id: activity.id,
        name: activity.name,
        color: activity.color,
        total_ms: 0,
      };
      row.total_ms += ms;
      byActivity.set(activity.id, row);
    }
    return {
      by_app: [...byApp.values()].sort((a, b) => b.total_ms - a.total_ms),
      by_activity: [...byActivity.values()].sort((a, b) => b.total_ms - a.total_ms),
      by_bucket: buckets.map((bucket) => ({
        range: bucket,
        total_ms: clip(bucket).reduce((sum, part) => sum + (Math.min(part.end, bucket.to) - Math.max(part.start, bucket.from)), 0),
      })),
      total_ms: total,
      auto_discarded_gaps: data.autoDiscarded.filter((at) => at >= range.from && at < range.to).length,
    };
  };

  const timeline = (range: RangeDto): TimelineItemDto[] =>
    clip(range)
      .sort((a, b) => a.start - b.start)
      .map(({ segment, start, end }) => {
        const activity = data.activities.find((c) => c.id === classify(segment, data.rules)) ?? data.activities[0];
        return {
          segment_id: segment.id,
          start,
          end,
          app_id: segment.app_id,
          app_name: segment.app_name,
          window_title: redact(segment),
          activity_id: activity?.id ?? SYSTEM_ACTIVITY,
          activity_name: activity?.name ?? "",
          activity_color: activity?.color ?? "#9ca3af",
          source: segment.source,
          end_reason: segment.end_reason,
          open: segment.ended_at === null,
        };
      });

  const resolveGap = (id: number, resolution: IdleResolutionDto) => {
    const gap = data.gaps.find((g) => g.id === id);
    if (!gap) fail({ kind: "not_found" });
    data.gaps = data.gaps.filter((g) => g.id !== id);
    if (resolution.kind === "assign_previous" && gap.prev_focus) {
      data.segments.push({
        id: data.nextIds.segment++,
        started_at: gap.started_at,
        ended_at: gap.ended_at,
        app_id: gap.prev_focus.app_id,
        app_name: gap.prev_focus.app_name,
        window_title: gap.prev_focus.window_title,
        source: "idle_assigned",
        activity_id: null,
        end_reason: "idle",
      });
    } else if (resolution.kind === "assign_activity") {
      data.segments.push({
        id: data.nextIds.segment++,
        started_at: gap.started_at,
        ended_at: gap.ended_at,
        app_id: null,
        app_name: null,
        window_title: null,
        source: "idle_assigned",
        activity_id: resolution.activity_id,
        end_reason: "idle",
      });
    }
  };

  const validateRule = (rule: RuleInputDto) => {
    if (rule.spec.kind !== "title_pattern") return;
    try {
      compilePattern(rule.spec.pattern);
    } catch (error) {
      fail({
        kind: "invalid_pattern",
        pattern: rule.spec.pattern,
        reason: error instanceof Error ? error.message : "invalid regular expression",
      });
    }
  };

  /** Apps in the history, most used first (like `ReportRepository::seen_apps`). */
  const seenApps = () => {
    const totals = new Map<string, { app_id: string; app_name: string; ms: number }>();
    for (const segment of data.segments) {
      if (!segment.app_id) continue;
      const row = totals.get(segment.app_id) ?? { app_id: segment.app_id, app_name: segment.app_name ?? segment.app_id, ms: 0 };
      row.ms += (segment.ended_at ?? clock()) - segment.started_at;
      totals.set(segment.app_id, row);
    }
    return [...totals.values()].sort((a, b) => b.ms - a.ms);
  };
  const covered = (appId: string) =>
    data.rules.some((r) => r.spec.app_id === appId);
  const findOrCreateActivity = (wanted: { key: string; name: string; color: string; productivity: ProductivityDto }) => {
    const existing =
      data.activities.find((a) => a.preset_key === wanted.key) ??
      data.activities.find((a) => a.name.toLowerCase() === wanted.name.toLowerCase());
    if (existing) return { activity: existing, created: false };
    const activity: ActivityDto = {
      id: data.nextIds.activity++,
      name: wanted.name,
      color: wanted.color,
      sort_order: data.activities.length,
      productivity: wanted.productivity,
      preset_key: wanted.key,
    };
    data.activities.push(activity);
    return { activity, created: true };
  };
  const addAppRule = (activityId: number, appId: string) =>
    data.rules.push({ id: data.nextIds.rule++, activity_id: activityId, spec: { kind: "app", app_id: appId }, priority: 0 });

  const issueToken = () => {
    const token = `mock-token-${++tokenCounter}`;
    liveTokens.add(token);
    return token;
  };
  const consumeToken = (token: string) => {
    if (!liveTokens.delete(token)) fail({ kind: "confirmation_required" });
  };
  const deleteWhere = (predicate: (segment: MockSegment) => boolean) => {
    const before = data.segments.length;
    data.segments = data.segments.filter((s) => s.ended_at === null || !predicate(s));
    return before - data.segments.length;
  };

  const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
    get_status: () => status(),
    start: () => {
      const focus = lastFocus();
      if (tracking !== "running" && focus) startSegment(focus);
      tracking = "running";
      return status();
    },
    resume: () => handlers.start?.({}),
    pause: () => {
      closeOpen("pause");
      tracking = "paused";
      return status();
    },
    stop: () => {
      closeOpen("stop");
      tracking = "stopped";
      return status();
    },
    get_report: (args) => report(args.range as RangeDto, (args.buckets as RangeDto[] | undefined) ?? []),
    get_dashboard: (args) =>
      buildDashboard({
        range: args.range as RangeDto,
        buckets: (args.buckets as RangeDto[] | undefined) ?? [],
        previous: (args.previous as RangeDto | null | undefined) ?? null,
        segments: data.segments,
        activities: data.activities,
        classify: (segment) => classify(segment, data.rules),
        title: redact,
        now: clock(),
      }),
    get_timeline: (args) => timeline(args.range as RangeDto),
    list_pending_idle_gaps: () => data.gaps,
    resolve_idle_gap: (args) => {
      resolveGap(args.id as number, args.resolution as IdleResolutionDto);
      return null;
    },
    activities_list: () => [...data.activities],
    activities_create: (args) => {
      const name = String(args.name).trim();
      if (!name) fail({ kind: "invalid", message: "the activity name cannot be empty" });
      if (data.activities.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
        fail({ kind: "invalid", message: `an activity named "${name}" already exists` });
      }
      const activity: ActivityDto = {
        id: data.nextIds.activity++,
        name,
        color: String(args.color),
        sort_order: data.activities.length,
        productivity: args.productivity as ProductivityDto,
        preset_key: null,
      };
      data.activities.push(activity);
      return activity;
    },
    activities_update: (args) => {
      const next = args.activity as ActivityDto;
      const index = data.activities.findIndex((c) => c.id === next.id);
      if (index < 0) fail({ kind: "not_found" });
      if (data.activities.some((c) => c.id !== next.id && c.name.toLowerCase() === next.name.trim().toLowerCase())) {
        fail({ kind: "invalid", message: `an activity named "${next.name}" already exists` });
      }
      data.activities[index] = { ...next, name: next.name.trim() };
      return null;
    },
    activities_delete: (args) => {
      const id = args.id as number;
      if (id === SYSTEM_ACTIVITY) fail({ kind: "invalid", message: "the system activity cannot be deleted" });
      data.activities = data.activities.filter((c) => c.id !== id);
      data.rules = data.rules.filter((r) => r.activity_id !== id);
      for (const segment of data.segments) {
        if (segment.activity_id === id) segment.activity_id = SYSTEM_ACTIVITY;
      }
      return null;
    },
    rules_list: () => [...data.rules],
    rules_upsert: (args) => {
      const rule = args.rule as RuleInputDto;
      validateRule(rule);
      const index = data.rules.findIndex((r) => r.id === rule.id);
      if (index >= 0) {
        data.rules[index] = { ...rule };
        return rule.id;
      }
      const id = data.nextIds.rule++;
      data.rules.push({ ...rule, id });
      return id;
    },
    rules_delete: (args) => {
      data.rules = data.rules.filter((r) => r.id !== args.id);
      return null;
    },
    presets_list: () => mockPresets(),
    presets_apply: (args) => {
      const pack = mockPresets().find((p) => p.key === args.key);
      if (!pack) fail({ kind: "not_found" });
      let activitiesCreated = 0;
      let rulesCreated = 0;
      const resolved = new Map<string, number>();
      for (const wanted of pack.activities) {
        const { activity, created } = findOrCreateActivity(wanted);
        resolved.set(wanted.key, activity.id);
        if (created) activitiesCreated++;
      }
      for (const app of seenApps()) {
        if (covered(app.app_id)) continue;
        const match = matchPreset(app.app_id, app.app_name, [pack.key]);
        const activityId = match ? resolved.get(match.activity.key) : undefined;
        if (activityId === undefined) continue;
        addAppRule(activityId, app.app_id);
        rulesCreated++;
      }
      return { activities_created: activitiesCreated, rules_created: rulesCreated };
    },
    suggestions_list: (): SuggestionDto[] =>
      seenApps().flatMap((app) => {
        if (covered(app.app_id) || dismissedSuggestions.has(app.app_id)) return [];
        const match = matchPreset(app.app_id, app.app_name);
        if (!match) return [];
        const existing = data.activities.find(
          (a) => a.preset_key === match.activity.key || a.name.toLowerCase() === match.activity.name.toLowerCase(),
        );
        return [
          {
            app_id: app.app_id,
            app_name: app.app_name,
            pack_key: match.pack,
            activity_key: match.activity.key,
            activity_name: match.activity.name,
            activity_id: existing?.id ?? null,
          },
        ];
      }),
    suggestions_accept: (args) => {
      const app = seenApps().find((a) => a.app_id === args.appId);
      const match = app ? matchPreset(app.app_id, app.app_name) : null;
      if (!app || !match) fail({ kind: "not_found" });
      if (covered(app.app_id)) return null;
      addAppRule(findOrCreateActivity(match.activity).activity.id, app.app_id);
      return null;
    },
    suggestions_dismiss: (args) => {
      dismissedSuggestions.add(String(args.appId));
      return null;
    },
    privacy_list: () => ({
      store_titles: settings.store_titles,
      excluded_apps: data.excluded,
      redacted_apps: data.redacted,
    }),
    privacy_set: (args) => {
      const appId = String(args.appId);
      data.excluded = data.excluded.filter((id) => id !== appId);
      data.redacted = data.redacted.filter((id) => id !== appId);
      if (args.mode === "exclude") data.excluded.push(appId);
      if (args.mode === "redact_title") data.redacted.push(appId);
      return null;
    },
    settings_get: () => settings,
    settings_update: (args) => {
      const patch = args.patch as SettingsPatchDto;
      const { retention, ...rest } = patch;
      const changes = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== null));
      settings = { ...settings, ...changes } as SettingsDto;
      if (retention) settings.retention_days = retention.kind === "forever" ? null : retention.days;
      return settings;
    },
    permission_status: () => permission,
    permission_request: () => null,
    permission_open_settings: () => {
      // The grant happens in System Settings: simulate it shortly after.
      setTimeout(() => (permission = "granted"), 1500);
      return null;
    },
    app_restart: () => null,
    open_main_window: () => null,
    close_onboarding: () => null,
    hide_popover: () => null,
    prepare_delete: () => issueToken(),
    delete_range: (args) => {
      consumeToken(String(args.confirmToken));
      const range = args.range as RangeDto;
      return deleteWhere((s) => s.started_at >= range.from && s.started_at < range.to);
    },
    purge_older_than: (args) => {
      consumeToken(String(args.confirmToken));
      const cutoff = clock() - (args.days as number) * 86_400_000;
      return deleteWhere((s) => (s.ended_at ?? 0) < cutoff);
    },
    delete_all: (args) => {
      consumeToken(String(args.confirmToken));
      data.segments = data.segments.filter((s) => s.ended_at === null);
      return null;
    },
    export_csv: () => "/Users/demo/Downloads/time-track.csv",
    update_check: () => offeredUpdate,
    // The real app downloads and relaunches: the UI stays on "Installing..." until it exits.
    update_install: () => new Promise(() => {}),
  };

  // E2E tests count data calls through this log (dev and test builds only).
  const callLog: string[] = [];
  (globalThis as { __mockIpcCalls?: string[] }).__mockIpcCalls = callLog;

  mockIPC(
    (cmd, args) => {
      callLog.push(cmd);
      const handler = handlers[cmd];
      if (handler) return handler((args ?? {}) as Record<string, unknown>);
      // Window and plugin calls the real app never grants to windows: ignore quietly.
      if (cmd.startsWith("plugin:")) return undefined;
      throw { kind: "internal", message: `unmocked command: ${cmd}` } satisfies AppError;
    },
    { shouldMockEvents: true },
  );

  // Without a Rust updater task there is nothing to emit the event: announce on load instead.
  if (offeredUpdate && options.announceUpdate) {
    const update = offeredUpdate;
    void import("@/shared/ipc").then(({ events }) => setTimeout(() => void events.updateAvailable.emit(update), 300));
  }
}
