/**
 * Progress for the mocked backend, mirroring `application::progress`: today's ensō, the level
 * from all-time strokes, the streak, the seals and the one moment to celebrate, chosen by the
 * same priority (oldest unseen seal, then a level-up, then today's full ensō). Strokes are
 * demo data and never change; dismissing a moment works in memory. Kept apart from
 * `mockBackend.ts`.
 */

import type {
  LevelNameDto,
  MomentDto,
  ProgressDto,
  SealDto,
  SealFamilyDto,
  SealViewDto,
  StrokeEntryDto,
  StrokeSourceDto,
} from "@/shared/ipc";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const DAILY_CAP = 100;

/**
 * Scenarios: the default has a seal waiting, `done` a full ensō to celebrate and `level` a
 * level-up (Flow) not acknowledged yet.
 */
export type DemoProgress = "done" | "level";

export interface ProgressEnv {
  clock: () => number;
  /** The `progress_enabled` setting. */
  enabled: () => boolean;
}

const LEVELS: readonly { name: LevelNameDto; min: number }[] = [
  { name: "start", min: 0 },
  { name: "steady", min: 300 },
  { name: "rhythm", min: 900 },
  { name: "flow", min: 2_000 },
  { name: "craft", min: 4_000 },
  { name: "mastery", min: 7_000 },
  { name: "kaizen", min: 12_000 },
];

/** Like `Seal::ALL`: the order the UI lists them in. */
const SEALS: readonly { id: SealDto; family: SealFamilyDto; target: number }[] = [
  { id: "first_focus", family: "focus", target: 1 },
  { id: "seven_days", family: "streaks", target: 7 },
  { id: "ten_sessions", family: "focus", target: 10 },
  { id: "took_the_break", family: "breaks", target: 1 },
  { id: "perfect_week", family: "goals", target: 7 },
  { id: "thirty_days", family: "streaks", target: 30 },
];

const STROKES: Record<StrokeSourceDto, number> = {
  focus_completed: 10,
  focus_on_target: 5,
  break_taken: 3,
  goal_met: 15,
  limit_respected: 10,
};

interface MockSeal {
  earnedAt: number | null;
  seen: boolean;
  /** Progress while locked. */
  current: number;
}

function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Local day number (days since 1970-01-01 of the local date), like `Calendar::local_day`. */
function localDay(ms: number): number {
  const date = new Date(ms);
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY);
}

export function createMockProgress(env: ProgressEnv, demo?: DemoProgress) {
  const now = env.clock();
  const today = startOfDay(now);
  /** A time earlier today, `ago` before now but never before midnight. */
  const earlier = (ago: number, order: number) => Math.max(today + order * MINUTE, now - ago);

  // 35 of 100: two focus blocks (one on target) and a third one, all earlier today.
  const sources: StrokeSourceDto[] = ["focus_completed", "focus_on_target", "focus_completed", "focus_completed"];
  if (demo === "done") {
    // Filled to the cap: the last break only fits 2.
    sources.push(
      "break_taken",
      "goal_met",
      "focus_completed",
      "focus_on_target",
      "goal_met",
      "focus_completed",
      "focus_on_target",
      "break_taken",
    );
  }
  const entries: StrokeEntryDto[] = [];
  let todayTotal = 0;
  sources.forEach((source, i) => {
    const strokes = Math.min(STROKES[source], DAILY_CAP - todayTotal);
    todayTotal += strokes;
    entries.push({ source, strokes, at: earlier((sources.length - i) * 25 * MINUTE, i) });
  });
  // All-time total: 2,410 (Flow, 410 of 2,000 to Craft) once today's 35 are in.
  const total = 2_375 + todayTotal;

  const earned = (daysAgo: number, seen = true): MockSeal => ({ earnedAt: now - daysAgo * DAY, seen, current: 0 });
  const locked = (current: number): MockSeal => ({ earnedAt: null, seen: false, current });
  const seals: Record<SealDto, MockSeal> = {
    first_focus: earned(60),
    seven_days: earned(30),
    // The default scenario celebrates this one.
    ten_sessions: earned(1, demo !== undefined),
    took_the_break: earned(50),
    perfect_week: locked(2),
    thirty_days: locked(12),
  };

  /** Like the `progress_moments` blob. */
  let levelSeen = demo === "level" ? 3 : 4;
  let dayDoneSeen: number | null = null;

  const level = () => {
    let index = 0;
    while (index + 1 < LEVELS.length && total >= LEVELS[index + 1]!.min) index += 1;
    const current = LEVELS[index]!;
    const next = LEVELS[index + 1] ?? null;
    return {
      number: index + 1,
      name: current.name,
      total,
      into_level: total - current.min,
      span: next ? next.min - current.min : null,
      next_name: next?.name ?? null,
    };
  };

  const sealViews = (): SealViewDto[] =>
    SEALS.map(({ id, family, target }) => {
      const seal = seals[id];
      const isEarned = seal.earnedAt !== null;
      return {
        id,
        family,
        earned: isEarned,
        earned_at: seal.earnedAt,
        seen: isEarned && seal.seen,
        current: isEarned ? target : Math.min(seal.current, target),
        target,
      };
    });

  const moment = (): MomentDto | null => {
    const unseen = sealViews()
      .filter((s) => s.earned && !s.seen)
      .sort((a, b) => (a.earned_at ?? 0) - (b.earned_at ?? 0))[0];
    if (unseen) return { kind: "seal", seal: unseen.id };
    const { number, name } = level();
    if (number > levelSeen) return { kind: "level", number, name };
    const day = localDay(now);
    if (todayTotal >= DAILY_CAP && dayDoneSeen !== day) return { kind: "day_done", day };
    return null;
  };

  const progress = (): ProgressDto => ({
    enabled: env.enabled(),
    today: { strokes: todayTotal, cap: DAILY_CAP, done: todayTotal >= DAILY_CAP, entries },
    level: level(),
    // Five days in a row ending today; the best run (12 days) was earlier.
    streak: { current: 5, best: 12, last7: [true, false, true, true, true, true, true] },
    seals: sealViews(),
    moment: moment(),
  });

  const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
    get_progress: () => progress(),
    dismiss_moment: (args) => {
      const dismissed = args.moment as MomentDto;
      switch (dismissed.kind) {
        case "seal":
          if (seals[dismissed.seal].earnedAt !== null) seals[dismissed.seal].seen = true;
          break;
        case "level":
          levelSeen = Math.max(levelSeen, dismissed.number);
          break;
        case "day_done":
          // The day the card was about, never lowered.
          dayDoneSeen = Math.max(dayDoneSeen ?? dismissed.day, dismissed.day);
          break;
      }
      return progress();
    },
  };

  return { handlers };
}
