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
import type { Messages } from "@/shared/i18n";
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
export function draftProblem(draft: FocusDraft, t: Messages): string | null {
  if (draft.intent.trim().length > MAX_INTENT_LENGTH) return t.focus.start.intentTooLong(MAX_INTENT_LENGTH);
  const minutes = draftMinutes(draft);
  if (!Number.isInteger(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
    return t.focus.start.badLength;
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
export function remainingLabel(ms: number, t: Messages): string {
  const m = t.focus.remaining;
  if (ms <= 0) return m.timeUp;
  const minutes = Math.ceil(ms / 60_000);
  if (minutes <= 1) return m.underMinute;
  return minutes < 60 ? m.minutes(minutes) : m.duration(formatDuration(ms));
}

export function kindLabel(kind: FocusKindDto, t: Messages): string {
  return t.focus.kinds[kind];
}

/** What to call a block in a sentence, with its task when it has one. */
export function blockTitle(step: Pick<FocusStepDto, "kind" | "intent">, t: Messages): string {
  return step.intent.trim() || t.focus.blockTitles[step.kind];
}

/** The end card's wording: a headline, a question about what comes next, the primary action. */
export function endCardCopy(card: FocusCardDto, t: Messages): { title: string; prompt: string; startLabel: string | null } {
  const m = t.focus.endCard;
  const finishedBreak = card.finished.kind === "break";
  const title = m.titles[card.finished.kind];
  const next = card.next;
  if (!next) {
    return { title, prompt: finishedBreak ? m.readyWhenYouAre : m.niceWork, startLabel: null };
  }
  const minutes = Math.round(next.planned_ms / 60_000);
  if (next.kind === "break") {
    return { title, prompt: m.takeBreak(minutes, next.long_break), startLabel: m.startBreak };
  }
  return {
    title,
    prompt: m.readyFor(minutes, next.intent.trim()),
    startLabel: next.kind === "focus" ? m.startFocus : m.startTimer,
  };
}

/** Round dots of the pomodoro cycle: `true` for each completed work block. */
export function roundDots(round: number, every: number): boolean[] {
  const total = Math.max(1, every);
  return Array.from({ length: total }, (_, index) => index < Math.min(round, total));
}

/** `2 activities and 3 apps`, or what applies. */
export function allowedSummary(allowed: FocusAllowedDto, t: Messages): string {
  const m = t.focus.allowedSummary;
  const activities = allowed.activity_ids.length > 0 ? m.activities(allowed.activity_ids.length) : null;
  const apps = allowed.app_ids.length > 0 ? m.apps(allowed.app_ids.length) : null;
  if (activities && apps) return m.both(activities, apps);
  return activities ?? apps ?? m.nothing;
}

export function endReasonLabel(reason: FocusEndDto, t: Messages): string {
  return t.focus.endReasons[reason];
}

/** The headline of a summary: how much of the tracked time stayed on target. */
export function summaryHeadline(session: Pick<FocusSessionDto, "percent_inside">, t: Messages): string {
  return session.percent_inside === null ? t.focus.summary.none : t.focus.summary.headline(session.percent_inside);
}

/** `3 alerts`, `1 alert`, `No alerts`. */
export function alertsText(count: number, t: Messages): string {
  return t.focus.alerts(count);
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
