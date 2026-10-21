import { describe, expect, it } from "vitest";

import type { ReportDto } from "@/shared/ipc";
import { MINUTE } from "@/shared/lib/time";
import { report } from "@/test/ipc";

import {
  appRows,
  averages,
  busiest,
  activityRows,
  compareTotals,
  dayBars,
  hourBars,
  niceCeiling,
} from "./summary";

const day = (offset: number) => ({ from: offset * 1000, to: (offset + 1) * 1000 });

function dayReport(total: number, activities: [number, string, number][]): ReportDto {
  return report({
    total_ms: total,
    by_activity: activities.map(([id, name, ms]) => ({ activity_id: id, name, color: "#3b82f6", total_ms: ms })),
  });
}

describe("compareTotals", () => {
  it("reports the change and its direction", () => {
    expect(compareTotals(90 * MINUTE, 60 * MINUTE)).toEqual({ deltaMs: 30 * MINUTE, pct: 50, direction: "up" });
    expect(compareTotals(30 * MINUTE, 60 * MINUTE)).toEqual({ deltaMs: -30 * MINUTE, pct: -50, direction: "down" });
    expect(compareTotals(MINUTE, MINUTE).direction).toBe("same");
  });

  it("has no percentage when there is nothing to compare with", () => {
    expect(compareTotals(MINUTE, 0)).toMatchObject({ pct: null, direction: "up" });
    expect(compareTotals(0, 0)).toMatchObject({ pct: null, direction: "same" });
  });
});

describe("dayBars", () => {
  it("stacks each day by activity, biggest first, with the Unassigned name mapped by id", () => {
    const bars = dayBars("week", [day(0), day(1)], [
      dayReport(3000, [
        [1, "Unassigned", 1000],
        [2, "Work", 2000],
      ]),
      undefined,
    ]);
    expect(bars[0]?.segments.map((s) => s.name)).toEqual(["Work", "Unassigned"]);
    expect(bars[0]?.totalMs).toBe(3000);
    // A day without a report yet is an empty bar, not a crash.
    expect(bars[1]).toMatchObject({ totalMs: 0, segments: [] });
  });

  it("drops empty activities and labels bars for the period", () => {
    const [bar] = dayBars("month", [day(0)], [dayReport(10, [[2, "Work", 0]])]);
    expect(bar?.segments).toEqual([]);
    expect(bar?.label).toMatch(/^\d+$/);
  });
});

describe("hourBars", () => {
  it("maps bucket totals to hours by start instant", () => {
    const hours = [day(0), day(1), day(2)];
    const bars = hourBars(report({ by_bucket: [{ range: day(1), total_ms: 500 }] }), hours);
    expect(bars.map((b) => b.totalMs)).toEqual([0, 500, 0]);
    expect(bars[1]?.segments).toHaveLength(1);
  });

  it("is all empty before the report arrives", () => {
    expect(hourBars(undefined, [day(0)])[0]?.totalMs).toBe(0);
  });
});

describe("chart helpers", () => {
  it("rounds the ceiling up to a round duration", () => {
    expect(niceCeiling(0)).toBe(60 * MINUTE);
    expect(niceCeiling(3 * MINUTE)).toBe(5 * MINUTE);
    expect(niceCeiling(61 * MINUTE)).toBe(120 * MINUTE);
    expect(niceCeiling(7 * 60 * MINUTE)).toBe(480 * MINUTE);
    expect(niceCeiling(30 * 60 * MINUTE)).toBe(30 * 60 * MINUTE);
  });

  it("averages only the days with tracked time and finds the busiest", () => {
    const bars = dayBars("week", [day(0), day(1), day(2)], [dayReport(100, []), dayReport(0, []), dayReport(300, [])]);
    expect(averages(bars)).toEqual({ perActiveDayMs: 200, activeDays: 2 });
    expect(busiest(bars)?.totalMs).toBe(300);
    expect(busiest(dayBars("week", [day(0)], [undefined]))).toBeNull();
    expect(averages([])).toEqual({ perActiveDayMs: 0, activeDays: 0 });
  });
});

describe("breakdown rows", () => {
  it("sorts and computes shares, mapping manual time and the system activity", () => {
    const apps = appRows(
      [
        { app_id: null, app_name: "", total_ms: 100 },
        { app_id: "a", app_name: "Xcode", total_ms: 300 },
      ],
      400,
    );
    expect(apps.map((r) => r.name)).toEqual(["Xcode", "Assigned manually"]);
    expect(apps[0]?.fraction).toBe(0.75);

    const activities = activityRows(
      [
        { activity_id: 1, name: "Unassigned", color: "#6b7280", total_ms: 50 },
        { activity_id: 2, name: "Work", color: "#3b82f6", total_ms: 150 },
      ],
      200,
    );
    expect(activities.map((r) => r.name)).toEqual(["Work", "Unassigned"]);
  });

  it("has zero shares for an empty period", () => {
    expect(appRows([{ app_id: "a", app_name: "A", total_ms: 0 }], 0)[0]?.fraction).toBe(0);
  });
});
