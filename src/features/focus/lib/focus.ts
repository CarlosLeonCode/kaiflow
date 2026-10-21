import type {
  FocusActiveDto,
  FocusAllowedDto,
  FocusCardDto,
  FocusEndDto,
  FocusKindDto,
  FocusSessionDto,
  FocusStartDto,
  FocusStepDto,
} from "@/shared/ipc";
import { formatDuration } from "@/shared/lib/time";

/** Pure view-model helpers for focus blocks, timers and breaks (no IPC, no clock). */

export const DURATION_PRESETS = [25, 50, 90] as const;
export const MAX_INTENT_LENGTH = 80;
export const MIN_MINUTES = 1;
export const MAX_MINUTES = 12 * 60;
/** Minutes added by "+5 min" (on the running card and on the end card). */
export const EXTEND_MINUTES = 5;
/** How long "Back to it" holds the next drift alert back. */
export const SNOOZE_MINUTES = 5;

export type DurationChoice = (typeof DURATION_PRESETS)[number] | "custom";

/** What each preset is good for, shown under the big number. */
export const PRESET_HINTS: Record<(typeof DURATION_PRESETS)[number], string> = {
  25: "Pomodoro",
  50: "Deep work",
  90: "Long haul",
};

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

/** Something allowed means drift nudges: a focus block. Nothing allowed is a plain timer. */
export function draftKind(draft: Pick<FocusDraft, "activityIds" | "appIds">): FocusKindDto {
  return draft.activityIds.length > 0 || draft.appIds.length > 0 ? "focus" : "timer";
}

/** What is wrong with the draft, in plain words, or `null` when it can start. */
export function draftProblem(draft: FocusDraft): string | null {
  if (draft.intent.trim().length > MAX_INTENT_LENGTH) return `Keep the task under ${MAX_INTENT_LENGTH} characters.`;
  const minutes = draftMinutes(draft);
  if (!Number.isInteger(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
    return "A block lasts between 1 minute and 12 hours.";
  }
  return null;
}

export function startOf(draft: FocusDraft): FocusStartDto {
  return {
    kind: draftKind(draft),
    intent: draft.intent.trim(),
    planned_minutes: draftMinutes(draft),
    allowed: { activity_ids: [...draft.activityIds], app_ids: [...draft.appIds] },
  };
}

/** A one-click timer (popover chips). */
export function quickTimer(minutes: number, intent: string): FocusStartDto {
  return { kind: "timer", intent: intent.trim(), planned_minutes: minutes, allowed: { activity_ids: [], app_ids: [] } };
}

/** Adds `value` when absent, removes it when present. */
export function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/** Time left; frozen while paused. */
export function remainingMs(session: Pick<FocusActiveDto, "planned_end" | "paused_at">, now: number): number {
  return Math.max(0, session.planned_end - (session.paused_at ?? now));
}

/** Share of the block that has passed, 0..1 (pauses excluded). */
export function progress(session: Pick<FocusActiveDto, "planned_end" | "paused_at" | "planned_ms">, now: number): number {
  if (session.planned_ms <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - remainingMs(session, now) / session.planned_ms));
}

/** `23:15`, or `1:05:00` from an hour up. Rounds up to the second so it never shows 00:00 early. */
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

export function kindLabel(kind: FocusKindDto): string {
  switch (kind) {
    case "focus":
      return "Focus";
    case "timer":
      return "Timer";
    case "break":
      return "Break";
  }
}

/** What to call a block in a sentence, with its task when it has one. */
export function blockTitle(step: Pick<FocusStepDto, "kind" | "intent">): string {
  const task = step.intent.trim();
  if (task) return task;
  return step.kind === "break" ? "Break" : step.kind === "focus" ? "Focus block" : "Timer";
}

/** `5-minute`. */
function minutesAdjective(ms: number): string {
  return `${Math.round(ms / 60_000)}-minute`;
}

/** The end card's wording: a headline, a question about what comes next, the primary action. */
export function endCardCopy(card: FocusCardDto): { title: string; prompt: string; startLabel: string | null } {
  const finishedBreak = card.finished.kind === "break";
  const title = finishedBreak ? "Break is over" : card.finished.kind === "focus" ? "Focus done" : "Time is up";
  const next = card.next;
  if (!next) {
    return { title, prompt: finishedBreak ? "Ready when you are." : "Nice work. Take a moment before the next thing.", startLabel: null };
  }
  if (next.kind === "break") {
    const kind = next.long_break ? "long break" : "break";
    return { title, prompt: `Take a ${minutesAdjective(next.planned_ms)} ${kind}?`, startLabel: "Start break" };
  }
  const task = next.intent.trim();
  const what = `another ${Math.round(next.planned_ms / 60_000)} minutes`;
  return {
    title,
    prompt: task ? `Ready for ${what} on “${task}”?` : `Ready for ${what}?`,
    startLabel: next.kind === "focus" ? "Start focus" : "Start timer",
  };
}

/** Round dots of the pomodoro cycle: `true` for each completed work block. */
export function roundDots(round: number, every: number): boolean[] {
  const total = Math.max(1, every);
  return Array.from({ length: total }, (_, index) => index < Math.min(round, total));
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

/** Work blocks (focus and timers) completed today and the time spent in all of today's work blocks. */
export function todayStats(
  history: readonly Pick<FocusSessionDto, "kind" | "started_at" | "end_reason" | "worked_ms">[],
  dayStart: number,
  dayEnd: number,
): { blocks: number; focusMs: number } {
  const today = history.filter((s) => s.kind !== "break" && s.started_at >= dayStart && s.started_at < dayEnd);
  return {
    blocks: today.filter((s) => s.end_reason === "completed").length,
    focusMs: today.reduce((sum, s) => sum + Math.max(0, s.worked_ms), 0),
  };
}
