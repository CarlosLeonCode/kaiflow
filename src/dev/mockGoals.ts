/**
 * Goals for the mocked backend, mirroring `domain::goals` and `application::goals`: progress in
 * the current period, streaks over the closed ones (rest days skipped, a miss resets, the open
 * period never breaks a run) and the once-per-period crossing events. Kept apart from
 * `mockBackend.ts` so the handler table stays readable.
 */

import type { GoalDto, GoalEventKindDto, GoalStateDto, GoalStatusDto, RangeDto } from "@/shared/ipc";
import { addLocalDays } from "@/shared/lib/time";
import { periodRange, type Period } from "@/features/overview/lib/periods";

import type { MockSegment } from "./seed";

const DAY = 86_400_000;
/** Same lookback as the backend (`STREAK_LOOKBACK_DAYS`). */
const LOOKBACK_DAYS = 180;

export interface MockGoal extends GoalDto {
  created_at: number;
}

export interface MockGoalEvent {
  goal_id: number;
  /** Start of the period (local midnight, ms). */
  period_start: number;
  kind: GoalEventKindDto;
  seen: boolean;
}

interface Context {
  segments: readonly MockSegment[];
  classify: (segment: MockSegment) => number;
  now: number;
  weekStart: number;
}

/** The goal as the wire carries it (without the mock's creation time). */
export function goalDto(goal: MockGoal): GoalDto {
  return {
    id: goal.id,
    label: goal.label,
    scope: goal.scope,
    period: goal.period,
    kind: goal.kind,
    target_ms: goal.target_ms,
    active_days: goal.active_days,
    archived: goal.archived,
  };
}

const PERIOD_OF = { daily: "day", weekly: "week", monthly: "month" } as const satisfies Record<GoalDto["period"], Period>;

function bounds(goal: GoalDto, at: number, weekStart: number): RangeDto {
  return periodRange(PERIOD_OF[goal.period], at, weekStart);
}

function activeOn(goal: GoalDto, dayStart: number): boolean {
  if (goal.period !== "daily") return true;
  const monday0 = (new Date(dayStart).getDay() + 6) % 7;
  return (goal.active_days & (1 << monday0)) !== 0;
}

function timeIn(goal: GoalDto, range: RangeDto, ctx: Context): number {
  let total = 0;
  for (const segment of ctx.segments) {
    const start = Math.max(segment.started_at, range.from);
    const end = Math.min(segment.ended_at ?? ctx.now, range.to);
    if (end <= start) continue;
    const counts =
      goal.scope.kind === "total" ||
      (goal.scope.kind === "activity" && ctx.classify(segment) === goal.scope.activity_id) ||
      (goal.scope.kind === "app" && segment.app_id === goal.scope.app_id);
    if (counts) total += end - start;
  }
  return total;
}

function stateOf(goal: GoalDto, actual: number): GoalStateDto {
  if (goal.kind === "minimum") return actual >= goal.target_ms ? "reached" : "pending";
  return actual > goal.target_ms ? "exceeded" : "pending";
}

function isMet(goal: GoalDto, total: number): boolean {
  return goal.kind === "minimum" ? total >= goal.target_ms : total <= goal.target_ms;
}

export interface MockStatus {
  status: GoalStatusDto;
  /** First day of the current streak run (ms), for the purge warning. */
  streakStart: number | null;
}

/** Progress and streak of one goal in its current period. */
export function goalStatus(goal: MockGoal, ctx: Context, events: readonly MockGoalEvent[]): MockStatus {
  const current = bounds(goal, ctx.now, ctx.weekStart);
  const actual = timeIn(goal, current, ctx);
  const state = stateOf(goal, actual);
  const active = activeOn(goal, current.from);

  // Closed periods, oldest first, from the goal's creation (never further back than the lookback).
  const floor = addLocalDays(ctx.now, -LOOKBACK_DAYS);
  const firstAt = Math.max(goal.created_at, floor);
  const closed: { start: number; outcome: "met" | "missed" | "rest" }[] = [];
  for (let range = bounds(goal, firstAt, ctx.weekStart); range.from < current.from; range = bounds(goal, range.to, ctx.weekStart)) {
    closed.push({
      start: range.from,
      outcome: !activeOn(goal, range.from) ? "rest" : isMet(goal, timeIn(goal, range, ctx)) ? "met" : "missed",
    });
  }

  let run = 0;
  let best = 0;
  let start: number | null = null;
  for (const period of closed) {
    if (period.outcome === "rest") continue;
    if (period.outcome === "missed") {
      run = 0;
      start = null;
    } else {
      if (run === 0) start = period.start;
      run += 1;
      best = Math.max(best, run);
    }
  }
  let atRisk = false;
  if (active) {
    if (goal.kind === "minimum" && state === "reached") {
      if (run === 0) start = current.from;
      run += 1;
      best = Math.max(best, run);
    } else if ((goal.kind === "minimum" && state !== "reached") || (goal.kind === "maximum" && state === "exceeded")) {
      atRisk = true;
    }
  }

  const unseen = events.find((e) => e.goal_id === goal.id && e.period_start === current.from && !e.seen);
  return {
    streakStart: run > 0 ? start : null,
    status: {
      goal: goalDto(goal),
      period: current,
      actual_ms: actual,
      target_ms: goal.target_ms,
      percent: Math.floor((actual * 100) / goal.target_ms),
      state,
      active,
      streak: { current: run, best, at_risk: atRisk },
      unseen: unseen?.kind ?? null,
    },
  };
}

/**
 * Records the thresholds crossed so far in the current periods (once per goal, period and
 * kind), like the goal watcher does when it wakes. Rest days are skipped.
 */
export function evaluateCrossings(goals: readonly MockGoal[], ctx: Context, events: MockGoalEvent[]): void {
  for (const goal of goals) {
    if (goal.archived) continue;
    const current = bounds(goal, ctx.now, ctx.weekStart);
    if (!activeOn(goal, current.from)) continue;
    const state = stateOf(goal, timeIn(goal, current, ctx));
    if (state === "pending") continue;
    const kind: GoalEventKindDto = state === "reached" ? "reached" : "exceeded";
    if (!events.some((e) => e.goal_id === goal.id && e.period_start === current.from && e.kind === kind)) {
      events.push({ goal_id: goal.id, period_start: current.from, kind, seen: false });
    }
  }
}

/** Saving a goal resets its current period and records the state it is already in, silently. */
export function baseline(goal: MockGoal, ctx: Context, events: MockGoalEvent[]): void {
  const current = bounds(goal, ctx.now, ctx.weekStart);
  const keep = events.filter((e) => !(e.goal_id === goal.id && e.period_start === current.from));
  events.length = 0;
  events.push(...keep);
  const state = stateOf(goal, timeIn(goal, current, ctx));
  if (state !== "pending" && !goal.archived) {
    events.push({ goal_id: goal.id, period_start: current.from, kind: state === "reached" ? "reached" : "exceeded", seen: true });
  }
}

/** Mirrors `Goal::validate`. Returns the message, or `null` when the goal is fine. */
export function goalProblem(goal: GoalDto, activityExists: (id: number) => boolean): string | null {
  const label = goal.label.trim();
  if (label === "") return "a goal needs a name";
  if (label.length > 60) return "the goal name is too long (60 characters at most)";
  const longest = goal.period === "daily" ? DAY : goal.period === "weekly" ? 7 * DAY : 31 * DAY;
  if (goal.target_ms <= 0 || goal.target_ms > longest) return "the target must be longer than zero and fit in the period";
  if (goal.active_days < 1 || goal.active_days > 127) return "choose at least one active day";
  if (goal.scope.kind === "app" && goal.scope.app_id.trim() === "") return "choose an app";
  if (goal.scope.kind === "activity" && !activityExists(goal.scope.activity_id)) return "that activity does not exist";
  return null;
}
