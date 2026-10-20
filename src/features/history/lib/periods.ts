import type { RangeDto } from "@/shared/ipc";
import { addLocalDays, HOUR } from "@/shared/lib/time";

/**
 * Period math for History. Every boundary is a local calendar date turned into an instant
 * (`new Date(y, m, d)`), never `+ 24 h`, so a 23 h or 25 h DST day keeps its real length
 * and week/month ranges stay aligned with local midnights (R8.3, design section 8). The
 * ranges are half-open `[from, to)` UTC milliseconds, ready for the backend.
 */

export type Period = "day" | "week" | "month";

/** Weeks start on Monday (ISO 8601). */
const WEEK_STARTS_ON = 1;

/** Local midnight of the first day of the period that contains `anchor`. */
export function periodStart(period: Period, anchor: number): number {
  const date = new Date(anchor);
  switch (period) {
    case "day":
      return addLocalDays(anchor, 0);
    case "week": {
      const sinceWeekStart = (date.getDay() - WEEK_STARTS_ON + 7) % 7;
      return addLocalDays(anchor, -sinceWeekStart);
    }
    case "month":
      return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  }
}

/** Start of the period `delta` periods away from the one containing `anchor`. */
export function shiftPeriod(period: Period, anchor: number, delta: number): number {
  const start = periodStart(period, anchor);
  switch (period) {
    case "day":
      return addLocalDays(start, delta);
    case "week":
      return addLocalDays(start, delta * 7);
    case "month": {
      const date = new Date(start);
      return new Date(date.getFullYear(), date.getMonth() + delta, 1).getTime();
    }
  }
}

/** Half-open range of the whole period containing `anchor`. */
export function periodRange(period: Period, anchor: number): RangeDto {
  return { from: periodStart(period, anchor), to: shiftPeriod(period, anchor, 1) };
}

export function previousRange(period: Period, range: RangeDto): RangeDto {
  return periodRange(period, shiftPeriod(period, range.from, -1));
}

/** The next period only exists while it has started: History never navigates into the future. */
export function canGoNext(period: Period, range: RangeDto, now: number): boolean {
  return shiftPeriod(period, range.from, 1) <= now;
}

/** One range per local calendar day inside `range`. */
export function dayRanges(range: RangeDto): RangeDto[] {
  const days: RangeDto[] = [];
  let from = range.from;
  while (from < range.to) {
    const to = Math.min(addLocalDays(from, 1), range.to);
    days.push({ from, to });
    from = to;
  }
  return days;
}

/** One range per hour, stepping by instants so a DST day has 23 or 25 of them. */
export function hourRanges(range: RangeDto): RangeDto[] {
  const hours: RangeDto[] = [];
  for (let from = range.from; from < range.to; from += HOUR) {
    hours.push({ from, to: Math.min(from + HOUR, range.to) });
  }
  return hours;
}

/** Buckets the backend should total for the view: hours inside a day, days otherwise. */
export function bucketsFor(period: Period, range: RangeDto): RangeDto[] {
  return period === "day" ? hourRanges(range) : dayRanges(range);
}

const dayFormat = { weekday: "long", month: "long", day: "numeric", year: "numeric" } as const;
const shortDate = { month: "short", day: "numeric", year: "numeric" } as const;

/** `Tuesday, October 20, 2026`, `Oct 19 – 25, 2026` or `October 2026`. */
export function periodLabel(period: Period, range: RangeDto): string {
  switch (period) {
    case "day":
      return new Date(range.from).toLocaleDateString(undefined, dayFormat);
    case "week": {
      const last = addLocalDays(range.from, 6);
      return new Intl.DateTimeFormat(undefined, shortDate).formatRange(range.from, last);
    }
    case "month":
      return new Date(range.from).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
}

/** What the comparison is against. */
export function previousLabel(period: Period): string {
  return { day: "the previous day", week: "the previous week", month: "the previous month" }[period];
}

export function periodNoun(period: Period): string {
  return { day: "day", week: "week", month: "month" }[period];
}
