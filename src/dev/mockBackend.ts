/**
 * In-memory stand-in for the Rust backend, installed with Tauri's `mockIPC` in dev and E2E
 * runs (`VITE_MOCK_IPC=1`). It mirrors the contract in `bindings.ts` closely enough to drive
 * the real UI: categorization precedence, range clipping, idle gap resolution, validated
 * rules and two-step destructive deletes with single-use tokens.
 */

import { mockIPC } from "@tauri-apps/api/mocks";

import type {
  AppError,
  AppTotalDto,
  CategoryDto,
  CategoryTotalDto,
  FocusDto,
  IdleResolutionDto,
  PermissionStateDto,
  RangeDto,
  ReportDto,
  RuleDto,
  RuleInputDto,
  SettingsDto,
  SettingsPatchDto,
  TimelineItemDto,
  TrackingStateDto,
  TrackingStatusDto,
  UpdateInfoDto,
} from "@/shared/ipc";

import { buildSeed, type MockData, type MockSegment } from "./seed";

const SYSTEM_CATEGORY = 1;
const MANUAL_APP_NAME = "Asignado manualmente";

export interface MockOptions {
  /** Start with Accessibility revoked (onboarding and the degraded banner). */
  permission?: PermissionStateDto;
  /** The update the server offers. */
  update?: UpdateInfoDto | null;
  /** Announce it at startup (like the daily background check) instead of only on a manual check. */
  announceUpdate?: boolean;
  now?: () => number;
}

/** Tauri rejects with the raw serialized error: throwing a plain object reproduces that. */
function fail(error: AppError): never {
  throw error;
}

export function categorize(segment: MockSegment, rules: readonly RuleDto[]): number {
  if (segment.category_id !== null) return segment.category_id;
  const ordered = [...rules].sort((a, b) => b.priority - a.priority || a.id - b.id);
  const title = segment.window_title ?? "";
  for (const rule of ordered) {
    if (rule.spec.kind !== "title_pattern") continue;
    if (rule.spec.app_id !== null && rule.spec.app_id !== segment.app_id) continue;
    if (compilePattern(rule.spec.pattern).test(title)) return rule.category_id;
  }
  for (const rule of ordered) {
    if (rule.spec.kind === "app" && rule.spec.app_id === segment.app_id) return rule.category_id;
  }
  return SYSTEM_CATEGORY;
}

/** The Rust regex crate accepts `(?i)`; JavaScript spells it as a flag. */
function compilePattern(pattern: string): RegExp {
  const insensitive = pattern.startsWith("(?i)");
  return new RegExp(insensitive ? pattern.slice(4) : pattern, insensitive ? "i" : "");
}

export function installMockBackend(options: MockOptions = {}): void {
  const clock = options.now ?? (() => Date.now());
  const data: MockData = buildSeed(clock());
  let permission: PermissionStateDto = options.permission ?? "granted";
  let tracking: TrackingStateDto = "running";
  let settings: SettingsDto = {
    store_titles: true,
    idle_threshold_secs: 300,
    idle_prompt_timeout_secs: 600,
    retention_days: null,
    theme: "system",
    autostart: false,
    shortcut: "⌃⌥⌘T",
    onboarding_completed: true,
    tray_display: "today_total",
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
      category_id: null,
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
    const byCategory = new Map<number, CategoryTotalDto>();
    let total = 0;
    for (const { segment, start, end } of clip(range)) {
      const ms = end - start;
      total += ms;
      const appKey = segment.app_id ?? "";
      const app = byApp.get(appKey) ?? {
        app_id: segment.app_id,
        app_name: segment.app_name ?? MANUAL_APP_NAME,
        total_ms: 0,
      };
      app.total_ms += ms;
      byApp.set(appKey, app);
      const categoryId = categorize(segment, data.rules);
      const category = data.categories.find((c) => c.id === categoryId) ?? data.categories[0];
      if (!category) continue;
      const row = byCategory.get(category.id) ?? {
        category_id: category.id,
        name: category.name,
        color: category.color,
        total_ms: 0,
      };
      row.total_ms += ms;
      byCategory.set(category.id, row);
    }
    return {
      by_app: [...byApp.values()].sort((a, b) => b.total_ms - a.total_ms),
      by_category: [...byCategory.values()].sort((a, b) => b.total_ms - a.total_ms),
      by_bucket: buckets.map((bucket) => ({
        range: bucket,
        total_ms: clip(bucket).reduce((sum, part) => sum + (Math.min(part.end, bucket.to) - Math.max(part.start, bucket.from)), 0),
      })),
      total_ms: total,
    };
  };

  const timeline = (range: RangeDto): TimelineItemDto[] =>
    clip(range)
      .sort((a, b) => a.start - b.start)
      .map(({ segment, start, end }) => {
        const category = data.categories.find((c) => c.id === categorize(segment, data.rules)) ?? data.categories[0];
        return {
          segment_id: segment.id,
          start,
          end,
          app_id: segment.app_id,
          app_name: segment.app_name,
          window_title: redact(segment),
          category_id: category?.id ?? SYSTEM_CATEGORY,
          category_name: category?.name ?? "",
          category_color: category?.color ?? "#9ca3af",
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
        category_id: null,
        end_reason: "idle",
      });
    } else if (resolution.kind === "assign_category") {
      data.segments.push({
        id: data.nextIds.segment++,
        started_at: gap.started_at,
        ended_at: gap.ended_at,
        app_id: null,
        app_name: null,
        window_title: null,
        source: "idle_assigned",
        category_id: resolution.category_id,
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
    get_timeline: (args) => timeline(args.range as RangeDto),
    list_pending_idle_gaps: () => data.gaps,
    resolve_idle_gap: (args) => {
      resolveGap(args.id as number, args.resolution as IdleResolutionDto);
      return null;
    },
    categories_list: () => data.categories,
    categories_create: (args) => {
      const name = String(args.name).trim();
      if (!name) fail({ kind: "invalid", message: "the category name cannot be empty" });
      if (data.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
        fail({ kind: "invalid", message: `a category named "${name}" already exists` });
      }
      const category: CategoryDto = {
        id: data.nextIds.category++,
        name,
        color: String(args.color),
        sort_order: data.categories.length,
      };
      data.categories.push(category);
      return category;
    },
    categories_update: (args) => {
      const next = args.category as CategoryDto;
      const index = data.categories.findIndex((c) => c.id === next.id);
      if (index < 0) fail({ kind: "not_found" });
      if (data.categories.some((c) => c.id !== next.id && c.name.toLowerCase() === next.name.trim().toLowerCase())) {
        fail({ kind: "invalid", message: `a category named "${next.name}" already exists` });
      }
      data.categories[index] = { ...next, name: next.name.trim() };
      return null;
    },
    categories_delete: (args) => {
      const id = args.id as number;
      if (id === SYSTEM_CATEGORY) fail({ kind: "invalid", message: "the system category cannot be deleted" });
      data.categories = data.categories.filter((c) => c.id !== id);
      data.rules = data.rules.filter((r) => r.category_id !== id);
      for (const segment of data.segments) {
        if (segment.category_id === id) segment.category_id = SYSTEM_CATEGORY;
      }
      return null;
    },
    rules_list: () => data.rules,
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

  mockIPC(
    (cmd, args) => {
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
