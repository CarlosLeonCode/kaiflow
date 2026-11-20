import type { GoalDto, GoalKindDto, GoalScopeDto, GoalStatusDto, PeriodDto, StreakDto } from "@/shared/ipc";
import type { Messages } from "@/shared/i18n";
import { HOUR, MINUTE } from "@/shared/lib/time";

/** Bit 0 = Monday .. bit 6 = Sunday, like the backend. */
export const ALL_DAYS = 0b1111111;
export const WEEKDAYS = 0b0011111;
export const WEEKEND = 0b1100000;

export const MAX_LABEL_LENGTH = 60;

const DAY_MS = 24 * HOUR;

/** The longest target that fits in a period (a day, a week, a month of 31 days). */
export function maxTargetMs(period: PeriodDto): number {
  return period === "daily" ? DAY_MS : period === "weekly" ? 7 * DAY_MS : 31 * DAY_MS;
}

/** `4h`, `1h 30m`, `45m`: compact, no zero padding. */
export function formatAmount(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / MINUTE));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function msFromParts(hours: number, minutes: number): number {
  return Math.round(hours) * HOUR + Math.round(minutes) * MINUTE;
}

export function partsFromMs(ms: number): { hours: number; minutes: number } {
  const total = Math.round(ms / MINUTE);
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/** `every day`, `every weekday`, `on Mon, Wed and Fri`... (daily goals only). */
export function daysPhrase(mask: number, t: Messages): string {
  const m = t.goals.cadence;
  if (mask === ALL_DAYS) return m.everyDay;
  if (mask === WEEKDAYS) return m.everyWeekday;
  if (mask === WEEKEND) return m.everyWeekendDay;
  const names = t.goals.daysInSentence.filter((_, index) => (mask & (1 << index)) !== 0);
  const [only] = names;
  if (only === undefined) return m.noDay;
  if (names.length === 1) return m.oneDay(only);
  return m.someDays(names);
}

export function cadencePhrase(period: PeriodDto, activeDays: number, t: Messages): string {
  return period === "daily"
    ? daysPhrase(activeDays, t)
    : period === "weekly"
      ? t.goals.cadence.everyWeek
      : t.goals.cadence.everyMonth;
}

export interface NameLookup {
  activity: (id: number) => string;
  app: (id: string) => string;
}

function scopePhrase(scope: GoalScopeDto, names: NameLookup, t: Messages): string {
  const m = t.goals.sentence;
  switch (scope.kind) {
    case "activity":
      return m.activity(names.activity(scope.activity_id));
    case "app":
      return m.app(names.app(scope.app_id));
    case "total":
      return m.total;
  }
}

/** The goal in one plain sentence: "At least 4h of Deep work every weekday." */
export function goalSentence(
  goal: Pick<GoalDto, "scope" | "kind" | "target_ms" | "period" | "active_days">,
  names: NameLookup,
  t: Messages,
): string {
  const lead = t.goals.sentence[goal.kind];
  return `${lead} ${formatAmount(goal.target_ms)} ${scopePhrase(goal.scope, names, t)} ${cadencePhrase(goal.period, goal.active_days, t)}.`;
}

/** A name for a goal the user left unnamed: "Deep work, at least 4h daily". */
export function suggestedLabel(
  goal: Pick<GoalDto, "scope" | "kind" | "target_ms" | "period">,
  names: NameLookup,
  t: Messages,
): string {
  const m = t.goals.suggested;
  const subject =
    goal.scope.kind === "activity"
      ? names.activity(goal.scope.activity_id)
      : goal.scope.kind === "app"
        ? names.app(goal.scope.app_id)
        : m.allTime;
  return `${subject}, ${m[goal.kind]} ${formatAmount(goal.target_ms)} ${m.periods[goal.period]}`.slice(0, MAX_LABEL_LENGTH);
}

/** `5 days in a row`, `1 week in a row`; `null` when there is no run to show. */
export function streakText(streak: StreakDto, period: PeriodDto, t: Messages): string | null {
  return streak.current > 0 ? t.goals.streak(streak.current, period) : null;
}

export function bestStreakText(streak: StreakDto, period: PeriodDto, t: Messages): string | null {
  return streak.best > 0 ? t.goals.best(streak.best, period) : null;
}

export type Tone = "neutral" | "good" | "warning";

/** Short state label for a goal in its current period. */
export function stateLabel(status: GoalStatusDto, t: Messages): { label: string; tone: Tone } {
  const m = t.goals.states;
  if (!status.active) return { label: m.restDay, tone: "neutral" };
  const minimum = status.goal.kind === "minimum";
  switch (status.state) {
    case "reached":
      return { label: m.reached, tone: "good" };
    case "exceeded":
      return { label: m.overLimit, tone: "warning" };
    case "pending":
      return minimum ? { label: m.inProgress, tone: "neutral" } : { label: m.withinLimit, tone: "good" };
  }
}

/** The text of the badge for a crossing the user has not acknowledged. */
export function unseenLabel(kind: "reached" | "exceeded", t: Messages): string {
  return t.goals.unseen[kind];
}

/** What is left, or how far over: "1h 30m to go", "20m over". */
export function remainingText(status: GoalStatusDto, t: Messages): string {
  const m = t.goals.remaining;
  const delta = status.target_ms - status.actual_ms;
  if (status.goal.kind === "minimum") {
    return delta > 0 ? m.toGo(formatAmount(delta)) : m.targetMet;
  }
  return delta >= 0 ? m.left(formatAmount(delta)) : m.over(formatAmount(-delta));
}

/** Fill of the progress bar, capped at 100. */
export function barPercent(status: GoalStatusDto): number {
  return Math.min(100, Math.max(0, status.percent));
}

/** The goals worth showing in tight spaces: unseen crossings first, then still-open ones. */
export function topGoals(statuses: readonly GoalStatusDto[], limit: number): GoalStatusDto[] {
  const rank = (s: GoalStatusDto) => (s.unseen ? 0 : s.active && s.state === "pending" ? 1 : s.active ? 2 : 3);
  return statuses
    .map((status, index) => ({ status, index }))
    .sort((a, b) => rank(a.status) - rank(b.status) || a.index - b.index)
    .slice(0, limit)
    .map(({ status }) => status);
}

export interface GoalDraft {
  label: string;
  scope: GoalScopeDto;
  kind: GoalKindDto;
  period: PeriodDto;
  hours: number;
  minutes: number;
  days: number;
}

export function emptyDraft(scope: GoalScopeDto): GoalDraft {
  return { label: "", scope, kind: "minimum", period: "daily", hours: 1, minutes: 0, days: ALL_DAYS };
}

export function draftOf(goal: GoalDto): GoalDraft {
  const { hours, minutes } = partsFromMs(goal.target_ms);
  return {
    label: goal.label,
    scope: goal.scope,
    kind: goal.kind,
    period: goal.period,
    hours,
    minutes,
    days: goal.active_days,
  };
}

/** Why the draft cannot be saved, or `null` when it can. */
export function draftProblem(draft: GoalDraft, t: Messages): string | null {
  const m = t.goals.problems;
  if (draft.label.trim().length > MAX_LABEL_LENGTH) return m.nameTooLong(MAX_LABEL_LENGTH);
  const hours = Number.isFinite(draft.hours) ? draft.hours : 0;
  const minutes = Number.isFinite(draft.minutes) ? draft.minutes : 0;
  if (hours < 0 || minutes < 0 || minutes > 59) return m.badParts;
  const target = msFromParts(hours, minutes);
  if (target <= 0) return m.zero;
  if (target > maxTargetMs(draft.period)) return m.tooLong[draft.period];
  if (draft.period === "daily" && (draft.days & ALL_DAYS) === 0) return m.noDays;
  if (draft.scope.kind === "app" && draft.scope.app_id.trim() === "") return m.noApp;
  return null;
}

/**
 * The goal to save. An unnamed goal gets `suggestedLabel` in the active language: the name is
 * stored, so it stays in that language if the UI language changes later.
 */
export function goalOf(draft: GoalDraft, names: NameLookup, t: Messages, id = 0, archived = false): GoalDto {
  const target_ms = msFromParts(draft.hours, draft.minutes);
  const active_days = draft.period === "daily" ? draft.days & ALL_DAYS : ALL_DAYS;
  const base = { scope: draft.scope, kind: draft.kind, target_ms, period: draft.period, active_days };
  const label = draft.label.trim() || suggestedLabel(base, names, t);
  return { id, label, archived, ...base };
}

/** What is in focus right now, as far as the screen knows (`activity_id` is `null` when unknown). */
export interface LiveFocus {
  app_id: string | null;
  activity_id: number | null;
}

function countsFor(scope: GoalScopeDto, live: LiveFocus): boolean {
  switch (scope.kind) {
    case "total":
      return true;
    case "app":
      return live.app_id === scope.app_id;
    case "activity":
      return live.activity_id === scope.activity_id;
  }
}

/**
 * Adds the time the open segment has accrued since the statuses were fetched to the goals it
 * counts for, so bars and states keep moving between backend events without any request. The
 * backend stays the source of truth: the next event replaces these figures.
 */
export function withLiveTime(
  statuses: readonly GoalStatusDto[],
  live: LiveFocus | null,
  elapsedMs: number,
): readonly GoalStatusDto[] {
  if (!live || elapsedMs <= 0) return statuses;
  return statuses.map((status) => {
    if (!status.active || !countsFor(status.goal.scope, live)) return status;
    const actual = status.actual_ms + elapsedMs;
    const target = status.target_ms;
    const state =
      status.goal.kind === "minimum"
        ? actual >= target
          ? "reached"
          : "pending"
        : actual > target
          ? "exceeded"
          : "pending";
    const completes = status.goal.kind === "minimum" && state === "reached" && status.state !== "reached";
    const run = status.streak.current + 1;
    return {
      ...status,
      actual_ms: actual,
      percent: Math.floor((actual * 100) / Math.max(1, target)),
      state,
      streak: completes
        ? { current: run, best: Math.max(status.streak.best, run), at_risk: false }
        : status.streak,
    };
  });
}
