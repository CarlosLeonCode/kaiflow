import { describe, expect, it } from "vitest";

import { formatAxisDuration, formatClock, formatDuration, formatHour, formatTimeOfDay, localDayRange } from "./time";

describe("localDayRange", () => {
  it("spans local midnight to the next local midnight around now", () => {
    const now = new Date(2026, 9, 20, 15, 30).getTime();
    const { from, to } = localDayRange(now);
    expect(from).toBe(new Date(2026, 9, 20).getTime());
    expect(to).toBe(new Date(2026, 9, 21).getTime());
    expect(from <= now && now < to).toBe(true);
  });

  it("builds the end from the calendar date, not from + 24 h", () => {
    const { from, to } = localDayRange(new Date(2026, 2, 8, 12).getTime());
    // Equal to 24 h except on DST days, where it is 23 or 25 h; never off by more than 1 h.
    expect(Math.abs(to - from - 24 * 3_600_000)).toBeLessThanOrEqual(3_600_000);
    expect(new Date(to).getHours()).toBe(0);
  });
});

describe("durations", () => {
  it("formats compact durations", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(24 * 60_000 + 59_000)).toBe("24m");
    expect(formatDuration(3_600_000 + 5 * 60_000)).toBe("1h 05m");
    expect(formatDuration(-5)).toBe("0s");
  });

  it("formats the live clock", () => {
    expect(formatClock(0)).toBe("0:00:00");
    expect(formatClock(3_725_000)).toBe("1:02:05");
  });
});

describe("formatAxisDuration", () => {
  it("drops zero minutes so axis labels stay short", () => {
    expect(formatAxisDuration(10 * 3_600_000)).toBe("10h");
    expect(formatAxisDuration(5 * 3_600_000)).toBe("5h");
    expect(formatAxisDuration(90 * 60_000)).toBe("1h 30m");
    expect(formatAxisDuration(30 * 60_000)).toBe("30m");
    expect(formatAxisDuration(150_000)).toBe("2m 30s");
    expect(formatAxisDuration(45_000)).toBe("45s");
    expect(formatAxisDuration(0)).toBe("0");
  });
});

describe("clock times", () => {
  // Built from local fields so the expectations hold in any time zone.
  const early = new Date(2026, 9, 20, 1, 21).getTime();
  const late = new Date(2026, 9, 20, 23, 54).getTime();
  const after = new Date(2026, 9, 21, 0, 6).getTime();
  const ampm = (text: string) => text.replace(/\s/g, " ");

  it("has no leading zero in 12-hour locales, like the rest of the range", () => {
    expect(ampm(formatTimeOfDay(early, "en-US"))).toBe("1:21 AM");
    expect(ampm(formatTimeOfDay(late, "en-US"))).toBe("11:54 PM");
    expect(ampm(formatTimeOfDay(after, "en-US"))).toBe("12:06 AM");
  });

  it("keeps the 24-hour convention in 24-hour locales", () => {
    expect(formatTimeOfDay(late, "de-DE")).toBe("23:54");
  });

  it("formats axis hours", () => {
    expect(ampm(formatHour(new Date(2026, 9, 20, 4).getTime(), "en-US"))).toBe("4 AM");
  });
});
