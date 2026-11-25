import type { LevelNameDto, SealDto, SealFamilyDto, StrokeEntryDto, StrokeSourceDto } from "@/shared/ipc";

import type { SealGlyph } from "./enso";

/** A pop fill: the four bright gamification colors. */
export type PopTone = "sun" | "mint" | "sky" | "pink";

/** Background class of each pop fill (text on it is always `on-pop`). */
export const POP_BG: Record<PopTone, string> = {
  sun: "bg-pop-sun",
  mint: "bg-pop-mint",
  sky: "bg-pop-sky",
  pink: "bg-pop-pink",
};

/** Seal families by color: sky focus, sun streaks, mint breaks, pink goals. */
export const FAMILY_TONE: Record<SealFamilyDto, PopTone> = {
  focus: "sky",
  streaks: "sun",
  breaks: "mint",
  goals: "pink",
};

export const SEAL_GLYPH: Record<SealDto, SealGlyph> = {
  first_focus: "dot",
  seven_days: "seven",
  ten_sessions: "ten",
  took_the_break: "pause",
  perfect_week: "ring",
  thirty_days: "dotted",
};

/** What a locked seal counts, for its hint ("12 of 30 days"). */
export const SEAL_UNIT: Record<SealDto, "days" | "sessions" | "breaks"> = {
  first_focus: "sessions",
  seven_days: "days",
  ten_sessions: "sessions",
  took_the_break: "breaks",
  perfect_week: "days",
  thirty_days: "days",
};

/** The levels in order, so a level's successor can be named. */
export const LEVEL_ORDER: readonly LevelNameDto[] = ["start", "steady", "rhythm", "flow", "craft", "mastery", "kaizen"];

export function nextLevel(name: LevelNameDto): LevelNameDto | null {
  return LEVEL_ORDER[LEVEL_ORDER.indexOf(name) + 1] ?? null;
}

/** `part / whole` clamped to 0..1 (0 when `whole` is not positive). */
export function fraction(part: number, whole: number): number {
  if (!(whole > 0)) return 0;
  return Math.max(0, Math.min(1, part / whole));
}

/** The order ledger rows are listed in, like the earning table. */
const SOURCE_ORDER: readonly StrokeSourceDto[] = [
  "focus_completed",
  "focus_on_target",
  "goal_met",
  "limit_respected",
  "break_taken",
];

export interface LedgerRow {
  source: StrokeSourceDto;
  count: number;
  strokes: number;
}

/**
 * Today's entries grouped by source. Entries past the daily cap (0 strokes) are left out:
 * nothing is shown as earned past the cap.
 */
export function ledgerRows(entries: readonly StrokeEntryDto[]): LedgerRow[] {
  const rows = new Map<StrokeSourceDto, LedgerRow>();
  for (const entry of entries) {
    if (entry.strokes <= 0) continue;
    const row = rows.get(entry.source) ?? { source: entry.source, count: 0, strokes: 0 };
    row.count += 1;
    row.strokes += entry.strokes;
    rows.set(entry.source, row);
  }
  return SOURCE_ORDER.flatMap((source) => rows.get(source) ?? []);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Narrow weekday initials of the `count` days ending on the local day of `now`, oldest first,
 * in `locale` ("M T W T F S S"): the labels under `StreakDots`.
 */
export function weekdayInitials(locale: string, now: number, count = 7): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(today.getTime() - (count - 1 - i) * DAY_MS);
    day.setHours(12, 0, 0, 0);
    return format.format(day).toLocaleUpperCase(locale);
  });
}
