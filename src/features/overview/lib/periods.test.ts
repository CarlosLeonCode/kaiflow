import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { HOUR } from "@/shared/lib/time";

import {
  bucketsFor,
  canGoNext,
  dayRanges,
  hourRanges,
  periodLabel,
  periodRange,
  periodStart,
  previousRange,
  shiftAnchor,
  shiftPeriod,
} from "./periods";

const originalTz = process.env.TZ;

function local(y: number, m: number, d: number, h = 0): number {
  return new Date(y, m - 1, d, h).getTime();
}

describe("period math in a DST time zone (America/New_York)", () => {
  beforeAll(() => {
    process.env.TZ = "America/New_York";
  });
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("runs on the zone the tests expect", () => {
    // 2026-03-08 is the spring-forward day: local midnight is UTC-5, noon is UTC-4.
    expect(new Date(2026, 2, 8, 0).getTimezoneOffset()).toBe(300);
    expect(new Date(2026, 2, 8, 12).getTimezoneOffset()).toBe(240);
  });

  it("a day is 23 hours on spring forward and 25 on fall back", () => {
    const spring = periodRange("day", local(2026, 3, 8, 15));
    const fall = periodRange("day", local(2026, 11, 1, 15));
    expect((spring.to - spring.from) / HOUR).toBe(23);
    expect((fall.to - fall.from) / HOUR).toBe(25);
    expect(spring).toEqual({ from: local(2026, 3, 8), to: local(2026, 3, 9) });
  });

  it("a normal day is 24 hours and contains its anchor", () => {
    const anchor = local(2026, 10, 20, 13);
    const range = periodRange("day", anchor);
    expect((range.to - range.from) / HOUR).toBe(24);
    expect(range.from <= anchor && anchor < range.to).toBe(true);
  });

  it("weeks start on Monday and keep local midnights across a DST change", () => {
    // Sunday March 8 belongs to the week of Monday March 2.
    const week = periodRange("week", local(2026, 3, 8, 20));
    expect(week.from).toBe(local(2026, 3, 2));
    expect(week.to).toBe(local(2026, 3, 9));
    expect((week.to - week.from) / HOUR).toBe(7 * 24 - 1);
    expect(periodStart("week", local(2026, 3, 9))).toBe(local(2026, 3, 9));
  });

  it("months span the first of the month to the first of the next, whatever their length", () => {
    expect(periodRange("month", local(2026, 3, 15))).toEqual({ from: local(2026, 3, 1), to: local(2026, 4, 1) });
    expect(periodRange("month", local(2026, 12, 31, 23))).toEqual({ from: local(2026, 12, 1), to: local(2027, 1, 1) });
    const february = periodRange("month", local(2028, 2, 10));
    expect(dayRanges(february)).toHaveLength(29);
  });

  it("shifts by calendar periods, never by fixed durations", () => {
    expect(shiftPeriod("day", local(2026, 3, 7, 18), 1)).toBe(local(2026, 3, 8));
    expect(shiftPeriod("day", local(2026, 3, 8, 18), 1)).toBe(local(2026, 3, 9));
    expect(shiftPeriod("week", local(2026, 3, 4), 1)).toBe(local(2026, 3, 9));
    expect(shiftPeriod("month", local(2026, 1, 31), 1)).toBe(local(2026, 2, 1));
    expect(shiftPeriod("month", local(2026, 1, 15), -1)).toBe(local(2025, 12, 1));
    expect(shiftPeriod("month", local(2026, 11, 20), 3)).toBe(local(2027, 2, 1));
  });

  it("previousRange is the adjacent period and ends where the current one starts", () => {
    for (const period of ["day", "week", "month"] as const) {
      const range = periodRange(period, local(2026, 3, 9, 10));
      expect(previousRange(period, range).to).toBe(range.from);
    }
    expect(previousRange("week", periodRange("week", local(2026, 3, 9)))).toEqual({
      from: local(2026, 3, 2),
      to: local(2026, 3, 9),
    });
  });

  it("never navigates into a period that has not started", () => {
    const now = local(2026, 10, 20, 12);
    const thisWeek = periodRange("week", now);
    expect(canGoNext("week", thisWeek, now)).toBe(false);
    expect(canGoNext("week", previousRange("week", thisWeek), now)).toBe(true);
    expect(canGoNext("day", periodRange("day", now), now)).toBe(false);
    expect(canGoNext("month", periodRange("month", local(2026, 9, 10)), now)).toBe(true);
    // The instant the next period starts, it becomes reachable.
    expect(canGoNext("day", periodRange("day", now), local(2026, 10, 21))).toBe(true);
  });

  it("splits a week into 7 contiguous local days even when one is 23 hours", () => {
    const week = periodRange("week", local(2026, 3, 4));
    const days = dayRanges(week);
    expect(days).toHaveLength(7);
    expect(days[0]?.from).toBe(week.from);
    expect(days.at(-1)?.to).toBe(week.to);
    days.slice(1).forEach((day, index) => expect(day.from).toBe(days[index]?.to));
    expect(days.map((d) => (d.to - d.from) / HOUR)).toEqual([24, 24, 24, 24, 24, 24, 23]);
    expect(days.every((d) => new Date(d.from).getHours() === 0)).toBe(true);
  });

  it("hour buckets cover the whole day: 23 on spring forward, 25 on fall back", () => {
    const spring = periodRange("day", local(2026, 3, 8, 9));
    const fall = periodRange("day", local(2026, 11, 1, 9));
    expect(hourRanges(spring)).toHaveLength(23);
    expect(hourRanges(fall)).toHaveLength(25);
    const hours = hourRanges(fall);
    expect(hours[0]?.from).toBe(fall.from);
    expect(hours.at(-1)?.to).toBe(fall.to);
  });

  it("chooses hourly buckets for a day and daily buckets otherwise", () => {
    const now = local(2026, 10, 20, 12);
    expect(bucketsFor("day", periodRange("day", now))).toHaveLength(24);
    expect(bucketsFor("week", periodRange("week", now))).toHaveLength(7);
    expect(bucketsFor("month", periodRange("month", now))).toHaveLength(31);
  });

  it("last90 is the 90 local days ending with today, across a DST change", () => {
    const now = local(2026, 3, 20, 15);
    const range = periodRange("last90", now);
    expect(range.to).toBe(local(2026, 3, 21));
    expect(range.from).toBe(local(2025, 12, 21));
    expect(dayRanges(range)).toHaveLength(90);
    expect(new Date(range.from).getHours()).toBe(0);
  });

  it("last90 navigates in 90 day steps, adjacent and never into the future", () => {
    const now = local(2026, 3, 20, 15);
    const range = periodRange("last90", now);
    const previous = previousRange("last90", range);
    expect(previous.to).toBe(range.from);
    expect(dayRanges(previous)).toHaveLength(90);
    expect(canGoNext("last90", range, now)).toBe(false);

    const back = periodRange("last90", shiftAnchor("last90", range, -1));
    expect(back).toEqual(previous);
    expect(canGoNext("last90", back, now)).toBe(true);
    expect(periodRange("last90", shiftAnchor("last90", back, 1))).toEqual(range);
  });

  it("last90 stacks weekly buckets that tile the range, the last one may be shorter", () => {
    const range = periodRange("last90", local(2026, 10, 20, 12));
    const weeks = bucketsFor("last90", range);
    expect(weeks).toHaveLength(13);
    expect(weeks[0]?.from).toBe(range.from);
    expect(weeks.at(-1)?.to).toBe(range.to);
    weeks.slice(1).forEach((week, index) => expect(week.from).toBe(weeks[index]?.to));
    expect(dayRanges(weeks.at(-1) ?? range)).toHaveLength(6);
  });

  it("labels each period with its year", () => {
    const now = local(2026, 10, 20, 12);
    expect(periodLabel("day", periodRange("day", now))).toContain("2026");
    expect(periodLabel("week", periodRange("week", now))).toContain("2026");
    expect(periodLabel("month", periodRange("month", now))).toContain("October");
    expect(periodLabel("last90", periodRange("last90", now))).toContain("2026");
  });
});

describe("period math in the southern hemisphere (Australia/Sydney)", () => {
  beforeAll(() => {
    process.env.TZ = "Australia/Sydney";
  });
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("DST starts on the first Sunday of October: that day has 23 hours", () => {
    const day = periodRange("day", local(2026, 10, 4, 12));
    expect((day.to - day.from) / HOUR).toBe(23);
    const week = periodRange("week", local(2026, 10, 4, 12));
    expect(week.from).toBe(local(2026, 9, 28));
    expect(dayRanges(week)).toHaveLength(7);
  });
});
