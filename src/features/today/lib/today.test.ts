import { describe, expect, it } from "vitest";

import type { TimelineItemDto } from "@/shared/ipc";
import { HOUR, MINUTE } from "@/shared/lib/time";

import {
  awayMs,
  axisTicks,
  buildAppRows,
  buildActivityRows,
  formatPercent,
  layoutTimeline,
  timelineWindow,
  titleBreakdown,
} from "./today";

const at = (h: number, m = 0) => new Date(2026, 9, 20, h, m).getTime();
const RANGE = { from: at(0), to: new Date(2026, 9, 21).getTime() };

let id = 0;
function item(start: number, end: number, overrides: Partial<TimelineItemDto> = {}): TimelineItemDto {
  id += 1;
  return {
    segment_id: id,
    start,
    end,
    app_id: "com.apple.dt.Xcode",
    app_name: "Xcode",
    window_title: "AppDelegate.swift",
    activity_id: 2,
    activity_name: "Work",
    activity_color: "#2f7de1",
    source: "tracked",
    end_reason: "focus_change",
    open: false,
    ...overrides,
  };
}

describe("timelineWindow", () => {
  it("spans from the first hour to the hour after the last block", () => {
    const win = timelineWindow([item(at(9, 20), at(11, 10)), item(at(11, 10), at(13, 5))], RANGE, at(13, 30));
    expect(win).toEqual({ from: at(9), to: at(14) });
  });

  it("never gets shorter than four hours", () => {
    const win = timelineWindow([item(at(9, 0), at(9, 30))], RANGE, at(9, 30));
    expect(win.to - win.from).toBe(4 * HOUR);
    expect(win.from).toBe(at(9));
  });

  it("stays inside the day near midnight", () => {
    const win = timelineWindow([item(at(23, 0), at(23, 50))], RANGE, at(23, 50));
    expect(win.to).toBe(RANGE.to);
    expect(win.from).toBe(RANGE.to - 4 * HOUR);
  });

  it("grows with the open segment up to now", () => {
    const win = timelineWindow([item(at(9, 0), at(9, 5), { open: true })], RANGE, at(15, 10));
    expect(win.to).toBe(at(16));
  });

  it("has a sane default without items", () => {
    const win = timelineWindow([], RANGE, at(10, 30));
    expect(win.to - win.from).toBe(4 * HOUR);
    expect(win.to).toBeGreaterThan(at(10, 30));
  });
});

describe("layoutTimeline", () => {
  it("positions blocks as percentages of the window", () => {
    const win = { from: at(8), to: at(12) };
    const [block] = layoutTimeline([item(at(9), at(10))], win, at(12));
    expect(block?.leftPct).toBeCloseTo(25);
    expect(block?.widthPct).toBeCloseTo(25);
    expect(block?.label).toBe("Xcode, Work");
    expect(block?.durationMs).toBe(HOUR);
  });

  it("clips blocks that cross the window edge and drops outside ones", () => {
    const win = { from: at(9), to: at(11) };
    const blocks = layoutTimeline([item(at(8), at(9, 30)), item(at(12), at(13))], win, at(13));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.leftPct).toBe(0);
    expect(blocks[0]?.widthPct).toBeCloseTo(25);
  });

  it("extends the open segment to now", () => {
    const win = { from: at(9), to: at(13) };
    const [block] = layoutTimeline([item(at(9), at(9, 1), { open: true })], win, at(11));
    expect(block?.widthPct).toBeCloseTo(50);
  });

  it("labels manual assignments and the system activity in English", () => {
    const [block] = layoutTimeline(
      [item(at(9), at(10), { app_id: null, app_name: null, activity_id: 1, activity_name: "Unassigned" })],
      { from: at(9), to: at(13) },
      at(13),
    );
    expect(block?.label).toBe("Assigned manually, Unassigned");
  });
});

describe("axisTicks", () => {
  it("ticks every hour on short windows", () => {
    const ticks = axisTicks({ from: at(9), to: at(13) });
    expect(ticks.map((t) => t.at)).toEqual([at(9), at(10), at(11), at(12), at(13)]);
    expect(ticks[0]?.pct).toBe(0);
    expect(ticks[4]?.pct).toBe(100);
  });

  it("thins ticks on long windows", () => {
    expect(axisTicks({ from: at(0), to: at(24) }).length).toBeLessThan(10);
  });
});

describe("titleBreakdown", () => {
  it("sums time per exact title, longest first, and groups missing titles", () => {
    const rows = titleBreakdown(
      [
        item(at(9), at(9, 10), { window_title: "a.swift" }),
        item(at(9, 10), at(10), { window_title: "b.swift" }),
        item(at(10), at(10, 20), { window_title: "a.swift" }),
        item(at(10, 20), at(10, 30), { window_title: null }),
      ],
      RANGE,
      at(12),
    ).get("com.apple.dt.Xcode");
    expect(rows).toEqual([
      { title: "b.swift", totalMs: 50 * MINUTE },
      { title: "a.swift", totalMs: 30 * MINUTE },
      { title: null, totalMs: 10 * MINUTE },
    ]);
  });

  it("keeps manual assignments under their own key", () => {
    const map = titleBreakdown([item(at(9), at(10), { app_id: null, app_name: null, window_title: null })], RANGE, at(12));
    expect(map.get("manual")).toEqual([{ title: null, totalMs: HOUR }]);
  });
});

describe("awayMs", () => {
  it("counts the gap after a segment closed by idle", () => {
    const away = awayMs(
      [item(at(9), at(10), { end_reason: "idle" }), item(at(10, 30), at(11))],
      RANGE,
      at(12),
    );
    expect(away).toBe(30 * MINUTE);
  });

  it("does not count pauses or an assigned idle block", () => {
    expect(
      awayMs([item(at(9), at(10), { end_reason: "pause" }), item(at(10, 30), at(11))], RANGE, at(12)),
    ).toBe(0);
    expect(
      awayMs(
        [item(at(9), at(10), { end_reason: "idle" }), item(at(10), at(10, 30), { source: "idle_assigned", end_reason: "idle" }), item(at(10, 30), at(11))],
        RANGE,
        at(12),
      ),
    ).toBe(0);
  });

  it("counts the time still away after the last segment", () => {
    expect(awayMs([item(at(9), at(10), { end_reason: "idle" })], RANGE, at(10, 45))).toBe(45 * MINUTE);
  });
});

describe("buildAppRows", () => {
  const byApp = [
    { app_id: "com.a", app_name: "A", total_ms: 10 * MINUTE },
    { app_id: null, app_name: "", total_ms: 5 * MINUTE },
  ];

  it("adds the live delta to the open app and keeps rows sorted", () => {
    const open = item(at(9), at(9, 1), { app_id: "com.a", app_name: "A", open: true });
    const rows = buildAppRows(byApp, open, 20 * MINUTE, new Map());
    expect(rows[0]).toMatchObject({ key: "com.a", totalMs: 30 * MINUTE, share: 1 });
    expect(rows[1]?.name).toBe("Assigned manually");
  });

  it("adds a row for an app that is not in the report yet", () => {
    const open = item(at(9), at(9, 1), { app_id: "com.new", app_name: "New", open: true });
    const rows = buildAppRows(byApp, open, 3 * MINUTE, new Map());
    expect(rows.map((r) => r.name)).toContain("New");
  });
});

describe("buildActivityRows", () => {
  it("computes the share of the total and renames the system activity", () => {
    const rows = buildActivityRows(
      [
        { activity_id: 1, name: "Unassigned", color: "#999", total_ms: 10 * MINUTE },
        { activity_id: 2, name: "Work", color: "#2f7de1", total_ms: 30 * MINUTE },
      ],
      undefined,
      0,
      40 * MINUTE,
    );
    expect(rows.map((r) => [r.name, r.fraction])).toEqual([
      ["Work", 0.75],
      ["Unassigned", 0.25],
    ]);
  });
});

describe("formatPercent", () => {
  it("never shows 0% for a little time", () => {
    expect(formatPercent(0.004)).toBe("<1%");
    expect(formatPercent(0.5)).toBe("50%");
    expect(formatPercent(0)).toBe("0%");
  });
});
