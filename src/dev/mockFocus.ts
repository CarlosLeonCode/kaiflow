/**
 * Focus blocks for the mocked backend, mirroring `domain::focus_session`,
 * `domain::focus_cycle` and `application::focus`: the drift rule (outside for the threshold
 * in a row, one alert per cooldown, snooze, nothing observed or paused suspends it), the
 * pomodoro cycle and its end card, and the summary derived from the tracked segments when a
 * focus block closes. Kept apart from `mockBackend.ts` so its handler table stays readable.
 */

import type {
  FocusAllowedDto,
  FocusAppDto,
  FocusCardActionDto,
  FocusEndDto,
  FocusKindDto,
  FocusSessionDto,
  FocusStartDto,
  FocusTimerSettingsDto,
} from "@/shared/ipc";

import type { MockSegment } from "./seed";

/** At least this long between two alerts of one session. */
export const ALERT_COOLDOWN_MS = 5 * 60_000;
const MIN_MS = 60_000;
const MAX_MS = 12 * 3_600_000;
const MAX_INTENT = 80;

export interface MockSession {
  id: number;
  kind: FocusKindDto;
  intent: string;
  started_at: number;
  planned_end: number;
  paused_at: number | null;
  paused_ms: number;
  allowed: FocusAllowedDto;
  drift_alerts: number;
  outside_since: number | null;
  last_alert: number | null;
  snoozed_until: number | null;
  alerting: boolean;
}

export function permits(allowed: FocusAllowedDto, app: Pick<FocusAppDto, "app_id" | "activity_id">): boolean {
  return allowed.app_ids.includes(app.app_id) || allowed.activity_ids.includes(app.activity_id);
}

/** Why a start request is refused, or `null`. The task name is optional. */
export function startProblem(start: FocusStartDto): string | null {
  const intent = start.intent.trim();
  if (intent.length > MAX_INTENT) return "the intent is too long (80 characters at most)";
  const ms = start.planned_minutes * 60_000;
  if (ms < MIN_MS || ms > MAX_MS) return "a session lasts between 1 minute and 12 hours";
  if (start.kind === "focus" && start.allowed.activity_ids.length === 0 && start.allowed.app_ids.length === 0) {
    return "allow at least one activity or app for drift alerts";
  }
  return null;
}

/** Time left; frozen while paused. */
export function remaining(session: Pick<MockSession, "planned_end" | "paused_at">, now: number): number {
  return Math.max(0, session.planned_end - (session.paused_at ?? now));
}

/** Planned length without the pauses. */
export function plannedMs(session: MockSession, now: number): number {
  const pausedNow = session.paused_at === null ? 0 : Math.max(0, now - session.paused_at);
  return Math.max(0, session.planned_end - session.started_at - session.paused_ms - pausedNow);
}

export function pause(session: MockSession, now: number): void {
  if (session.paused_at !== null) return;
  session.paused_at = now;
  session.outside_since = null;
  session.alerting = false;
}

export function resume(session: MockSession, now: number): void {
  if (session.paused_at === null) return;
  const paused = Math.max(0, now - session.paused_at);
  session.planned_end += paused;
  session.paused_ms += paused;
  session.paused_at = null;
}

// ---- the pomodoro cycle (domain::focus_cycle) ----

/** A cycle left alone this long starts over. */
const CYCLE_RESET_MS = 2 * 3_600_000;

export interface MockStep {
  kind: FocusKindDto;
  planned_ms: number;
  intent: string;
  allowed: FocusAllowedDto;
  long_break: boolean;
}

export interface MockCycle {
  round: number;
  last_work: MockStep | null;
  last_end_at: number | null;
  card: { finished: MockStep; at: number; next: MockStep | null } | null;
  continuing: boolean;
  deferred: MockStep | null;
  long_break_running: boolean;
}

export function emptyCycle(): MockCycle {
  return { round: 0, last_work: null, last_end_at: null, card: null, continuing: false, deferred: null, long_break_running: false };
}

export function cycleStarted(c: MockCycle, step: MockStep, now: number): void {
  if (c.last_end_at !== null && now - c.last_end_at >= CYCLE_RESET_MS) c.round = 0;
  c.card = null;
  c.continuing = false;
  c.deferred = null;
  c.long_break_running = step.kind === "break" && step.long_break;
  if (step.kind !== "break") c.last_work = { ...step, long_break: false };
}

export function cycleCompleted(c: MockCycle, finished: MockStep, at: number, timer: FocusTimerSettingsDto): void {
  const every = Math.max(1, timer.long_break_every);
  let next: MockStep | null;
  if (c.continuing) {
    next = c.deferred;
    c.deferred = null;
  } else if (finished.kind !== "break") {
    c.round = Math.min(c.round + 1, every);
    const long = c.round >= every;
    next = timer.cycle_enabled
      ? {
          kind: "break",
          planned_ms: (long ? timer.long_break_minutes : timer.short_break_minutes) * 60_000,
          intent: "",
          allowed: { activity_ids: [], app_ids: [] },
          long_break: long,
        }
      : null;
  } else {
    if (c.long_break_running) c.round = 0;
    next = timer.cycle_enabled ? c.last_work : null;
  }
  c.continuing = false;
  c.long_break_running = false;
  c.last_end_at = at;
  c.card = { finished, at, next };
}

export function cycleCancelled(c: MockCycle, at: number): void {
  c.card = null;
  c.continuing = false;
  c.deferred = null;
  c.long_break_running = false;
  c.last_end_at = at;
}

/** Answers the end card; returns the block to start, if any. */
export function cycleAnswer(c: MockCycle, action: FocusCardActionDto, now: number): MockStep | null {
  const card = c.card;
  if (!card) return null;
  c.card = null;
  switch (action.kind) {
    case "start_next":
      if (!card.next) return null;
      cycleStarted(c, card.next, now);
      return card.next;
    case "skip":
      if (card.next?.long_break) c.round = 0;
      c.last_end_at = now;
      return null;
    case "more_time":
      c.continuing = true;
      c.deferred = card.next;
      c.long_break_running = card.finished.kind === "break" && card.finished.long_break;
      return { ...card.finished, planned_ms: Math.min(60, Math.max(1, action.minutes)) * 60_000 };
  }
}

/**
 * Looks at what is in front: starts or stops the outside timer and raises an alert when one
 * is due. `current` is `null` when nothing is observed (paused, idle, degraded).
 */
export function observe(session: MockSession, current: FocusAppDto | null, now: number, driftAfterMs: number): void {
  const outside =
    session.kind === "focus" && session.paused_at === null && current !== null && !permits(session.allowed, current);
  if (!outside) {
    session.outside_since = null;
    session.alerting = false;
    return;
  }
  session.outside_since ??= now;
  const due = Math.max(
    session.outside_since + driftAfterMs,
    session.last_alert === null ? 0 : session.last_alert + ALERT_COOLDOWN_MS,
    session.snoozed_until ?? 0,
  );
  if (now >= due) {
    session.alerting = true;
    session.last_alert = now;
    session.drift_alerts += 1;
  }
}

/** Splits the tracked time inside `[from, to)` into on and off target, like `summarize`. */
export function summarize(
  segments: readonly MockSegment[],
  allowed: FocusAllowedDto,
  classify: (segment: MockSegment) => number,
  from: number,
  to: number,
  now: number,
): Pick<FocusSessionDto, "inside_ms" | "outside_ms" | "percent_inside" | "top_distractions"> {
  let inside = 0;
  let outside = 0;
  const distractions = new Map<string, { app_id: string; app_name: string; ms: number }>();
  for (const segment of segments) {
    const start = Math.max(segment.started_at, from);
    const end = Math.min(segment.ended_at ?? now, to);
    if (end <= start) continue;
    const appId = segment.app_id ?? "";
    if (allowed.app_ids.includes(appId) || allowed.activity_ids.includes(classify(segment))) {
      inside += end - start;
      continue;
    }
    outside += end - start;
    const row = distractions.get(appId) ?? { app_id: appId, app_name: segment.app_name ?? "Assigned time", ms: 0 };
    row.ms += end - start;
    distractions.set(appId, row);
  }
  const total = inside + outside;
  return {
    inside_ms: inside,
    outside_ms: outside,
    percent_inside: total > 0 ? Math.round((inside * 100) / total) : null,
    top_distractions: [...distractions.values()]
      .sort((a, b) => b.ms - a.ms || a.app_name.localeCompare(b.app_name))
      .slice(0, 3),
  };
}

export function closed(
  session: MockSession,
  at: number,
  reason: FocusEndDto,
  summary: ReturnType<typeof summarize>,
): FocusSessionDto {
  const ended = Math.max(at, session.started_at);
  return {
    id: session.id,
    kind: session.kind,
    intent: session.intent,
    started_at: session.started_at,
    planned_end: session.planned_end,
    ended_at: ended,
    end_reason: reason,
    drift_alerts: session.drift_alerts,
    allowed: session.allowed,
    ...summary,
    // Only a focus block has a summary to look at.
    seen: session.kind !== "focus",
    worked_ms: Math.max(0, ended - session.started_at - session.paused_ms),
  };
}
