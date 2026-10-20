import { describe, expect, it } from "vitest";

import { buildTopApps, degradedLabel, elapsedSinceFetch, toggleAction } from "./derive";

const byApp = [
  { app_id: "a", app_name: "Alpha", total_ms: 60_000 },
  { app_id: "b", app_name: "Beta", total_ms: 120_000 },
  { app_id: null, app_name: "Assigned manually", total_ms: 30_000 },
];

describe("buildTopApps", () => {
  it("sorts descending, limits and computes bar shares", () => {
    const rows = buildTopApps(byApp, null, 0, 2);
    expect(rows.map((r) => r.name)).toEqual(["Beta", "Alpha"]);
    expect(rows.map((r) => r.share)).toEqual([1, 0.5]);
  });

  it("adds the live delta to the foreground app and can reorder", () => {
    const rows = buildTopApps(byApp, { app_id: "a", app_name: "Alpha", window_title: null }, 90_000, 5);
    expect(rows[0]).toMatchObject({ name: "Alpha", totalMs: 150_000 });
  });

  it("adds a row when the foreground app has no stored time yet", () => {
    const rows = buildTopApps([], { app_id: "c", app_name: "Gamma", window_title: null }, 5_000, 5);
    expect(rows).toEqual([{ key: "c", name: "Gamma", totalMs: 5_000, share: 1 }]);
  });

  it("returns no rows and no NaN shares for an empty day", () => {
    expect(buildTopApps([], null, 0, 5)).toEqual([]);
  });
});

describe("elapsedSinceFetch", () => {
  it("only accrues while running and never goes negative", () => {
    expect(elapsedSinceFetch(1_000, 4_000, true)).toBe(3_000);
    expect(elapsedSinceFetch(1_000, 4_000, false)).toBe(0);
    expect(elapsedSinceFetch(5_000, 4_000, true)).toBe(0);
  });
});

describe("degradedLabel", () => {
  it("names what is missing for each platform reason", () => {
    expect(degradedLabel("accessibility_denied")).toBe("Tracking, titles off");
    expect(degradedLabel(null)).toBe("Tracking, titles off");
    expect(degradedLabel("wayland_session")).toBe("Tracking, windows unavailable");
    expect(degradedLabel("no_display")).toBe("Tracking, windows unavailable");
  });
});

describe("toggleAction", () => {
  it("maps each state like the tray menu", () => {
    expect(toggleAction("running")?.command).toBe("pause");
    expect(toggleAction("paused")?.command).toBe("resume");
    expect(toggleAction("stopped")?.command).toBe("start");
    expect(toggleAction("idle")).toBeNull();
    expect(toggleAction("asleep")).toBeNull();
  });
});
