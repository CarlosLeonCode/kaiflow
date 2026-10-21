import { mockIPC } from "@tauri-apps/api/mocks";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import type {
  AiProviderInfoDto,
  AiReviewDto,
  AiSettingsDto,
  BackupStatusDto,
  DashboardDto,
  FocusActiveDto,
  FocusDto,
  FocusSessionDto,
  FocusStatusDto,
  GoalDto,
  GoalStatusDto,
  ReportDto,
  WeeklyReviewDto,
  SettingsDto,
  TrackingStatusDto,
} from "@/shared/ipc";
import { AppProviders, createQueryClient } from "@/shared/app/AppProviders";

export const FIXED_NOW = Date.UTC(2026, 9, 20, 12, 0, 0);

export function focus(overrides: Partial<FocusDto> = {}): FocusDto {
  return { app_id: "com.apple.dt.Xcode", app_name: "Xcode", window_title: "AppDelegate.swift", ...overrides };
}

export function status(overrides: Partial<TrackingStatusDto> = {}): TrackingStatusDto {
  return {
    state: "running",
    current: focus(),
    since: FIXED_NOW - 5 * 60_000,
    degraded: false,
    degraded_reason: null,
    shortcut: { kind: "registered", shortcut: "⌃⌥⌘T" },
    ...overrides,
  };
}

export function report(overrides: Partial<ReportDto> = {}): ReportDto {
  return { by_app: [], by_activity: [], by_bucket: [], total_ms: 0, auto_discarded_gaps: 0, ...overrides };
}

/** An empty dashboard (nothing tracked, no previous period); override what the test needs. */
export function dashboard(overrides: Partial<DashboardDto> = {}): DashboardDto {
  return {
    range: { from: 0, to: 1 },
    total_ms: 0,
    previous_total_ms: 0,
    trend: { kind: "no_comparison" },
    by_activity: [],
    by_app: [],
    top_titles: [],
    buckets: [],
    heatmap: Array.from({ length: 7 * 24 }, () => 0),
    productivity: { productive_ms: 0, neutral_ms: 0, distracting_ms: 0 },
    focus_ratio: { kind: "no_signal" },
    auto_discarded_gaps: 0,
    goals: [],
    ...overrides,
  };
}

export function goal(overrides: Partial<GoalDto> = {}): GoalDto {
  return {
    id: 1,
    label: "Deep work",
    scope: { kind: "activity", activity_id: 2 },
    period: "daily",
    kind: "minimum",
    target_ms: 4 * 3_600_000,
    active_days: 0b0011111,
    archived: false,
    ...overrides,
  };
}

/** A goal in progress (1h of 4h, nothing crossed); override what the test needs. */
export function goalStatus(overrides: Partial<GoalStatusDto> = {}, goalOverrides: Partial<GoalDto> = {}): GoalStatusDto {
  return {
    goal: goal(goalOverrides),
    period: { from: 0, to: 1 },
    actual_ms: 3_600_000,
    target_ms: goalOverrides.target_ms ?? 4 * 3_600_000,
    percent: 25,
    state: "pending",
    active: true,
    streak: { current: 0, best: 0, at_risk: false },
    unseen: null,
    ...overrides,
  };
}

export function settings(overrides: Partial<SettingsDto> = {}): SettingsDto {
  return {
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
    week_start: 0,
    focus_drift_after_secs: 90,
    focus_timer: {
      cycle_enabled: true,
      short_break_minutes: 5,
      long_break_minutes: 15,
      long_break_every: 4,
      auto_start_next: false,
      sound: true,
      heads_up: false,
    },
    ui: { dismissed_intros: [] },
    ...overrides,
  };
}

/** No session running and nothing waiting; override what the test needs. */
export function idleFocus(overrides: Partial<FocusStatusDto> = {}): FocusStatusDto {
  return {
    active: null,
    unseen: null,
    card: null,
    cycle: { enabled: true, round: 0, every: 4 },
    unavailable: null,
    ...overrides,
  };
}

export function backupStatus(overrides: Partial<BackupStatusDto> = {}): BackupStatusDto {
  return {
    enabled: true,
    custom_dir: null,
    dir: "/data/backups",
    last_backup_at: null,
    last_error: null,
    stored: 0,
    ...overrides,
  };
}

/** What the backend answers to `settings_update`: stored settings with the non-null patch fields applied. */
export function mergePatch(patch: unknown, base: SettingsDto = settings()): SettingsDto {
  const changes = Object.fromEntries(
    Object.entries(patch as Record<string, unknown>).filter(([, value]) => value !== null),
  );
  return { ...base, ...changes } as SettingsDto;
}

export type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;

export interface Call {
  cmd: string;
  args: Record<string, unknown>;
}

/**
 * Mocks the Tauri IPC with one handler per command (Tauri's `mockIPC`) and records every
 * call. Unknown commands reject so a missing mock fails loudly. Events are mocked too.
 */
export function mockBackend(handlers: Handlers): { calls: Call[] } {
  const calls: Call[] = [];
  mockIPC(
    (cmd, args) => {
      if (cmd.startsWith("plugin:event|")) return undefined;
      const payload = (args ?? {}) as Record<string, unknown>;
      calls.push({ cmd, args: payload });
      const handler =
        handlers[cmd] ??
        (cmd === "settings_get"
          ? () => settings()
          : cmd === "backup_status"
            ? () => backupStatus()
            : cmd === "goals_status" || cmd === "goals_list" || cmd === "focus_history"
              ? () => []
              : cmd === "focus_status"
                ? () => idleFocus()
                : cmd === "rules_preview"
                  ? () => ({ total_ms: 0, windows: 0, unassigned_ms: 0 })
                  : undefined);
      if (!handler) throw new Error(`unmocked command: ${cmd}`);
      return handler(payload);
    },
    { shouldMockEvents: true },
  );
  return { calls };
}

/** Renders inside the real providers with a retry-free query client. */
export function renderWithProviders(ui: ReactElement) {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  return { client, ...render(<AppProviders client={client}>{ui}</AppProviders>) };
}

const MIN = 60_000;

/** A running session, 10 minutes in, 40 to go, nothing alerting; override what the test needs. */
export function focusActive(overrides: Partial<FocusActiveDto> = {}): FocusActiveDto {
  return {
    id: 7,
    kind: "focus",
    intent: "Write report",
    started_at: FIXED_NOW - 10 * MIN,
    planned_end: FIXED_NOW + 40 * MIN,
    paused_at: null,
    planned_ms: 50 * MIN,
    drift_alerts: 0,
    allowed: { activity_ids: [2], app_ids: ["com.microsoft.Excel"] },
    current: { app_id: "com.apple.dt.Xcode", app_name: "Xcode", activity_id: 2 },
    alerting: null,
    ...overrides,
  };
}

/** A finished session with a summary; override what the test needs. */
export function focusSession(overrides: Partial<FocusSessionDto> = {}): FocusSessionDto {
  return {
    id: 3,
    kind: "focus",
    intent: "Write report",
    started_at: FIXED_NOW - 2 * 3_600_000,
    planned_end: FIXED_NOW - 3_600_000,
    ended_at: FIXED_NOW - 3_600_000,
    end_reason: "completed",
    drift_alerts: 2,
    allowed: { activity_ids: [2], app_ids: [] },
    inside_ms: 45 * MIN,
    outside_ms: 15 * MIN,
    percent_inside: 75,
    top_distractions: [{ app_id: "com.tinyspeck.slackmacgap", app_name: "Slack", ms: 12 * MIN }],
    seen: false,
    worked_ms: 60 * MIN,
    ...overrides,
  };
}

/** The four providers, all off; override what the test needs. */
export function aiSettings(overrides: Partial<AiSettingsDto> = {}, provider: Partial<AiProviderInfoDto> = {}): AiSettingsDto {
  const base: AiProviderInfoDto[] = [
    { provider: "anthropic", label: "Anthropic (Claude)", needs_key: true, local: false, default_model: "claude-haiku-5-5", model: "claude-haiku-5-5", enabled: false, consented_at: null, has_key: false, base_url: null },
    { provider: "gemini", label: "Google Gemini", needs_key: true, local: false, default_model: "gemini-3.5-flash-lite", model: "gemini-3.5-flash-lite", enabled: false, consented_at: null, has_key: false, base_url: null },
    { provider: "openai", label: "OpenAI", needs_key: true, local: false, default_model: "gpt-6-luna", model: "gpt-6-luna", enabled: false, consented_at: null, has_key: false, base_url: null },
    { provider: "ollama", label: "Ollama (on this computer)", needs_key: false, local: true, default_model: "", model: "", enabled: false, consented_at: null, has_key: true, base_url: "http://localhost:11434" },
  ];
  const selected = overrides.selected ?? "anthropic";
  return {
    selected,
    include_titles: false,
    monday_review: false,
    last_auto_error: null,
    providers: base.map((p) => (p.provider === selected ? { ...p, ...provider } : p)),
    secret_store: { available: true, reason: null },
    ...overrides,
  };
}

/** A stored analysis with a structured answer; override what the test needs. */
export function aiReview(overrides: Partial<AiReviewDto> = {}): AiReviewDto {
  return {
    id: 1,
    period_start: FIXED_NOW - 7 * 86_400_000,
    period_end: FIXED_NOW,
    period_label: "2026-10-12 to 2026-10-18",
    provider: "anthropic",
    model: "claude-haiku-5-5",
    included_titles: false,
    request_json: '{"totals":{"tracked_minutes":180}}',
    status: "ok",
    output: {
      summary: "A steady week.",
      wins: ["Focused mornings"],
      patterns: [{ observation: "Late browsing", evidence: "90 minutes after 22:00" }],
      goal_misses: [{ goal: "Write daily", reason: "Tuesday was full of meetings" }],
      suggestions: [{ action: "Close the browser at 21:00", rationale: "It cuts late use" }],
    },
    text: null,
    created_at: FIXED_NOW,
    ...overrides,
  };
}

/** A week with some tracked time; override what the test needs. */
export function review(overrides: Partial<WeeklyReviewDto> = {}): WeeklyReviewDto {
  return {
    weeks_ago: 0,
    first_day: 20_738,
    from: Date.UTC(2026, 9, 12),
    to: Date.UTC(2026, 9, 19),
    label: "2026-10-12 to 2026-10-18",
    dashboard: dashboard({
      total_ms: 3 * 3_600_000,
      by_activity: [
        { activity_id: 2, name: "Deep work", color: "#3b82f6", total_ms: 2 * 3_600_000, productivity: "productive" },
        { activity_id: 3, name: "Email", color: "#22c55e", total_ms: 3_600_000, productivity: "neutral" },
      ],
      productivity: { productive_ms: 2 * 3_600_000, neutral_ms: 3_600_000, distracting_ms: 0 },
      focus_ratio: { kind: "ratio", ratio: 1 },
    }),
    goals: [],
    focus: [],
    note: "",
    reviews: [],
    ...overrides,
  };
}
