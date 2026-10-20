import { describe, expect, it } from "vitest";

import { formatClock, formatDuration, localDayRange } from "./time";

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
