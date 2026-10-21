import type {
  FocusActiveDto,
  FocusAllowedDto,
  FocusEndDto,
  FocusSessionDto,
  FocusStartDto,
} from "@/shared/ipc";
import { formatDuration } from "@/shared/lib/time";

/** Pure view-model helpers for focus sessions (no IPC, no clock). */

export const DURATION_PRESETS = [25, 50, 90] as const;
export const MAX_INTENT_LENGTH = 80;
export const MIN_MINUTES = 1;
export const MAX_MINUTES = 12 * 60;
/** Minutes added by "+10 min". */
export const EXTEND_MINUTES = 10;
/** How long "Back to it" holds the next drift alert back. */
export const SNOOZE_MINUTES = 5;

export type DurationChoice = (typeof DURATION_PRESETS)[number] | "custom";

export interface FocusDraft {
  intent: string;
  duration: DurationChoice;
  customMinutes: number;
  activityIds: number[];
  appIds: string[];
}

export function emptyDraft(): FocusDraft {
  return { intent: "", duration: 25, customMinutes: 30, activityIds: [], appIds: [] };
}

export function draftMinutes(draft: FocusDraft): number {
  return draft.duration === "custom" ? draft.customMinutes : draft.duration;
}

/** What is wrong with the draft, in plain words, or `null` when it can start. */
export function draftProblem(draft: FocusDraft): string | null {
  const intent = draft.intent.trim();
  if (intent === "") return "Describe what you want to focus on.";
  if (intent.length > MAX_INTENT_LENGTH) return `Keep it under ${MAX_INTENT_LENGTH} characters.`;
  const minutes = draftMinutes(draft);
  if (!Number.isInteger(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
    return "A session lasts between 1 minute and 12 hours.";
  }
  if (draft.activityIds.length === 0 && draft.appIds.length === 0) {
    return "Allow at least one activity or app, so we know what counts as being on track.";
  }
  return null;
}

export function startOf(draft: FocusDraft): FocusStartDto {
  return {
    intent: draft.intent.trim(),
    planned_minutes: draftMinutes(draft),
    allowed: { activity_ids: [...draft.activityIds], app_ids: [...draft.appIds] },
  };
}

/** Adds `value` when absent, removes it when present. */
export function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function remainingMs(session: Pick<FocusActiveDto, "planned_end">, now: number): number {
  return Math.max(0, session.planned_end - now);
}

/** Share of the planned time that has passed, 0..100. */
export function elapsedPercent(session: Pick<FocusActiveDto, "started_at" | "planned_end">, now: number): number {
  const total = session.planned_end - session.started_at;
  if (total <= 0) return 100;
  return Math.min(100, Math.max(0, Math.round(((now - session.started_at) / total) * 100)));
}

/** `23:15`, or `1:05:00` from an hour up. Rounds up to the second so it never shows 0:00 early. */
export function countdownText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** Spoken form of the countdown for assistive technology: `23 minutes left`. */
export function remainingLabel(ms: number): string {
  if (ms <= 0) return "Time is up";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes <= 1) return "Under a minute left";
  return minutes < 60 ? `${minutes} minutes left` : `${formatDuration(ms)} left`;
}

/** `2 activities and 3 apps`, or what applies. */
export function allowedSummary(allowed: FocusAllowedDto): string {
  const part = (count: number, one: string, many: string) => (count === 1 ? `1 ${one}` : `${count} ${many}`);
  const parts = [
    allowed.activity_ids.length > 0 ? part(allowed.activity_ids.length, "activity", "activities") : null,
    allowed.app_ids.length > 0 ? part(allowed.app_ids.length, "app", "apps") : null,
  ].filter((p): p is string => p !== null);
  return parts.length === 0 ? "Nothing allowed" : parts.join(" and ");
}

export function endReasonLabel(reason: FocusEndDto): string {
  switch (reason) {
    case "completed":
      return "Completed";
    case "cancelled":
      return "Ended early";
    case "recovered":
      return "Ended while the app was closed";
  }
}

/** The headline of a summary: how much of the tracked time stayed on target. */
export function summaryHeadline(session: Pick<FocusSessionDto, "percent_inside">): string {
  return session.percent_inside === null
    ? "No tracked time during this session"
    : `${session.percent_inside}% of your time stayed on target`;
}

/** `3 alerts`, `1 alert`, `No alerts`. */
export function alertsText(count: number): string {
  return count === 0 ? "No alerts" : count === 1 ? "1 alert" : `${count} alerts`;
}

/** Planned length of a finished session, e.g. `50m`. */
export function plannedText(session: Pick<FocusSessionDto, "started_at" | "planned_end">): string {
  return formatDuration(session.planned_end - session.started_at);
}
