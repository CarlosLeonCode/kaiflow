/**
 * Focus sessions for the mocked backend, mirroring `domain::focus_session` and
 * `application::focus`: the drift rule (outside for the threshold in a row, one alert per
 * cooldown, snooze, nothing observed suspends it) and the summary derived from the tracked
 * segments when a session closes. Kept apart from `mockBackend.ts` so its handler table stays
 * readable.
 */

import type { FocusAllowedDto, FocusAppDto, FocusEndDto, FocusSessionDto, FocusStartDto } from "@/shared/ipc";

import type { MockSegment } from "./seed";

/** At least this long between two alerts of one session. */
export const ALERT_COOLDOWN_MS = 5 * 60_000;
const MIN_MS = 60_000;
const MAX_MS = 12 * 3_600_000;
const MAX_INTENT = 80;

export interface MockSession {
  id: number;
  intent: string;
  started_at: number;
  planned_end: number;
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

/** Why a start request is refused, or `null`. */
export function startProblem(start: FocusStartDto): string | null {
  const intent = start.intent.trim();
  if (intent === "") return "describe what you want to focus on";
  if (intent.length > MAX_INTENT) return "the intent is too long (80 characters at most)";
  const ms = start.planned_minutes * 60_000;
  if (ms < MIN_MS || ms > MAX_MS) return "a session lasts between 1 minute and 12 hours";
  if (start.allowed.activity_ids.length === 0 && start.allowed.app_ids.length === 0) {
    return "allow at least one activity or app";
  }
  return null;
}

/**
 * Looks at what is in front: starts or stops the outside timer and raises an alert when one
 * is due. `current` is `null` when nothing is observed (paused, idle, degraded).
 */
export function observe(session: MockSession, current: FocusAppDto | null, now: number, driftAfterMs: number): void {
  const outside = current !== null && !permits(session.allowed, current);
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
  return {
    id: session.id,
    intent: session.intent,
    started_at: session.started_at,
    planned_end: session.planned_end,
    ended_at: Math.max(at, session.started_at),
    end_reason: reason,
    drift_alerts: session.drift_alerts,
    allowed: session.allowed,
    ...summary,
    seen: false,
  };
}
