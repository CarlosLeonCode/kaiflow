import { describe, expect, it } from "vitest";

import { MINUTE } from "@/shared/lib/time";
import { dashboard } from "@/test/ipc";

import {
  activityRows,
  appRows,
  averages,
  bucketBars,
  busiest,
  titleRows,
  trendPoints,
  trendView,
} from "./summary";

const range = (offset: number) => ({ from: offset * 1000, to: (offset + 1) * 1000 });

describe("trendView", () => {
  it("states the change and its direction in words", () => {
    expect(trendView("week", { kind: "change", delta_ms: 30 * MINUTE, pct: 50 })).toEqual({
      direction: "up",
      text: "30m more than the previous week (+50%)",
    });
    expect(trendView("month", { kind: "change", delta_ms: -30 * MINUTE, pct: -50 })).toEqual({
      direction: "down",
      text: "30m less than the previous month (-50%)",
    });
    expect(trendView("day", { kind: "change", delta_ms: 0, pct: 0 })).toEqual({
      direction: "same",
      text: "Same as the previous day",
    });
  });

  it("says there is no comparison instead of inventing a percentage", () => {
    expect(trendView("last90", { kind: "no_comparison" })).toEqual({
      direction: "none",
      text: "No comparison: nothing was tracked in the previous 90 days",
    });
  });
});

describe("bucketBars", () => {
  const data = dashboard({
    total_ms: 3000,
    by_activity: [
      { activity_id: 2, name: "Work", color: "#3b82f6", productivity: "productive", total_ms: 2000 },
      { activity_id: 1, name: "Whatever the backend stored", color: "#6b7280", productivity: "neutral", total_ms: 1000 },
    ],
    buckets: [
      {
        range: range(0),
        total_ms: 3000,
        by_activity: [
          { activity_id: 2, total_ms: 2000 },
          { activity_id: 1, total_ms: 1000 },
        ],
      },
      { range: range(1), total_ms: 0, by_activity: [] },
    ],
  });

  it("names and colors the slices the backend already split, Unassigned by id", () => {
    const bars = bucketBars("week", data);
    expect(bars[0]?.segments.map((s) => [s.name, s.color, s.ms])).toEqual([
      ["Work", "#3b82f6", 2000],
      ["Unassigned", "#6b7280", 1000],
    ]);
    // An empty bucket is an empty bar, not a crash.
    expect(bars[1]).toMatchObject({ totalMs: 0, segments: [] });
  });

  it("labels bars for each period", () => {
    expect(bucketBars("month", data)[0]?.label).toMatch(/^\d+$/);
    expect(bucketBars("last90", data)[0]?.fullLabel).toMatch(/^Week of /);
    expect(bucketBars("week", data)[0]?.fullLabel).toContain(",");
  });

  it("turns bars into trend points", () => {
    const points = trendPoints(bucketBars("week", data));
    expect(points.map((p) => p.totalMs)).toEqual([3000, 0]);
    expect(points[0]?.key).toBe(0);
  });
});

describe("bar statistics", () => {
  it("averages only the buckets with tracked time and finds the busiest", () => {
    const data = dashboard({
      buckets: [
        { range: range(0), total_ms: 100, by_activity: [] },
        { range: range(1), total_ms: 0, by_activity: [] },
        { range: range(2), total_ms: 300, by_activity: [] },
      ],
    });
    const bars = bucketBars("week", data);
    expect(averages(bars)).toEqual({ perActiveBucketMs: 200, activeBuckets: 2 });
    expect(busiest(bars)?.totalMs).toBe(300);
    expect(averages([])).toEqual({ perActiveBucketMs: 0, activeBuckets: 0 });
    expect(busiest(bucketBars("week", dashboard({ buckets: [{ range: range(0), total_ms: 0, by_activity: [] }] })))).toBeNull();
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
        { activity_id: 1, name: "Unassigned", color: "#6b7280", productivity: "neutral", total_ms: 50 },
        { activity_id: 2, name: "Work", color: "#3b82f6", productivity: "productive", total_ms: 150 },
      ],
      200,
    );
    expect(activities.map((r) => r.name)).toEqual(["Work", "Unassigned"]);
  });

  it("has zero shares for an empty period", () => {
    expect(appRows([{ app_id: "a", app_name: "A", total_ms: 0 }], 0)[0]?.fraction).toBe(0);
  });

  it("lists window titles with their app", () => {
    const rows = titleRows(
      [
        { app_id: "x", app_name: "Xcode", window_title: "Tracker.swift", total_ms: 600 },
        { app_id: null, app_name: null, window_title: "Notes", total_ms: 400 },
      ],
      1000,
    );
    expect(rows.map((r) => [r.name, r.detail, r.fraction])).toEqual([
      ["Tracker.swift", "Xcode", 0.6],
      ["Notes", "Assigned manually", 0.4],
    ]);
  });
});
