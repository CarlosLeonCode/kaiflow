import { describe, expect, it } from "vitest";

import {
  allowedSummary,
  alertsText,
  countdownText,
  draftMinutes,
  draftProblem,
  elapsedPercent,
  emptyDraft,
  endReasonLabel,
  plannedText,
  remainingLabel,
  remainingMs,
  startOf,
  summaryHeadline,
  toggled,
  type FocusDraft,
} from "./focus";

const MIN = 60_000;

function draft(changes: Partial<FocusDraft> = {}): FocusDraft {
  return { ...emptyDraft(), intent: "Write report", appIds: ["excel"], ...changes };
}

describe("the start draft", () => {
  it("is valid with an intent, a duration and something allowed", () => {
    expect(draftProblem(draft())).toBeNull();
  });

  it("explains what is missing in plain words", () => {
    expect(draftProblem(draft({ intent: "  " }))).toMatch(/Describe what you want to focus on/);
    expect(draftProblem(draft({ intent: "x".repeat(81) }))).toMatch(/under 80 characters/);
    expect(draftProblem(draft({ appIds: [], activityIds: [] }))).toMatch(/Allow at least one activity or app/);
    expect(draftProblem(draft({ activityIds: [2], appIds: [] }))).toBeNull();
  });

  it("checks the custom duration", () => {
    for (const minutes of [0, -5, 721, Number.NaN, 1.5]) {
      expect(draftProblem(draft({ duration: "custom", customMinutes: minutes }))).toMatch(/1 minute and 12 hours/);
    }
    expect(draftProblem(draft({ duration: "custom", customMinutes: 720 }))).toBeNull();
  });

  it("starts from the presets and from a custom length", () => {
    expect(draftMinutes(draft({ duration: 50 }))).toBe(50);
    expect(draftMinutes(draft({ duration: "custom", customMinutes: 35 }))).toBe(35);
  });

  it("builds the request the backend expects, with a trimmed intent", () => {
    expect(startOf(draft({ intent: " Write report ", duration: 90, activityIds: [2], appIds: ["excel"] }))).toEqual({
      intent: "Write report",
      planned_minutes: 90,
      allowed: { activity_ids: [2], app_ids: ["excel"] },
    });
  });

  it("toggles an entry in a list without mutating it", () => {
    const list = ["a"];
    expect(toggled(list, "b")).toEqual(["a", "b"]);
    expect(toggled(list, "a")).toEqual([]);
    expect(list).toEqual(["a"]);
  });
});

describe("the countdown", () => {
  const session = { started_at: 0, planned_end: 50 * MIN };

  it("never goes below zero and counts down to the end", () => {
    expect(remainingMs(session, 20 * MIN)).toBe(30 * MIN);
    expect(remainingMs(session, 60 * MIN)).toBe(0);
  });

  it("shows minutes and seconds, hours from an hour up, rounding up so 0:00 means done", () => {
    expect(countdownText(23 * MIN + 15_000)).toBe("23:15");
    expect(countdownText(5_000)).toBe("00:05");
    expect(countdownText(0)).toBe("00:00");
    expect(countdownText(500)).toBe("00:01");
    expect(countdownText(65 * MIN)).toBe("1:05:00");
  });

  it("says it for assistive technology", () => {
    expect(remainingLabel(23 * MIN)).toBe("23 minutes left");
    expect(remainingLabel(30_000)).toBe("Under a minute left");
    expect(remainingLabel(0)).toBe("Time is up");
    expect(remainingLabel(90 * MIN)).toBe("1h 30m left");
  });

  it("tells how much of the session has passed", () => {
    expect(elapsedPercent(session, 0)).toBe(0);
    expect(elapsedPercent(session, 25 * MIN)).toBe(50);
    expect(elapsedPercent(session, 90 * MIN)).toBe(100);
    expect(elapsedPercent({ started_at: 5, planned_end: 5 }, 5)).toBe(100);
  });
});

describe("wording", () => {
  it("summarizes what a session allows", () => {
    expect(allowedSummary({ activity_ids: [2, 3], app_ids: ["a", "b", "c"] })).toBe("2 activities and 3 apps");
    expect(allowedSummary({ activity_ids: [2], app_ids: [] })).toBe("1 activity");
    expect(allowedSummary({ activity_ids: [], app_ids: ["a"] })).toBe("1 app");
    expect(allowedSummary({ activity_ids: [], app_ids: [] })).toBe("Nothing allowed");
  });

  it("labels how a session ended", () => {
    expect(endReasonLabel("completed")).toBe("Completed");
    expect(endReasonLabel("cancelled")).toBe("Ended early");
    expect(endReasonLabel("recovered")).toBe("Ended while the app was closed");
  });

  it("headlines the summary, with and without tracked time", () => {
    expect(summaryHeadline({ percent_inside: 82 })).toBe("82% of your time stayed on target");
    expect(summaryHeadline({ percent_inside: null })).toBe("No tracked time during this session");
  });

  it("counts alerts and plans", () => {
    expect([0, 1, 3].map(alertsText)).toEqual(["No alerts", "1 alert", "3 alerts"]);
    expect(plannedText({ started_at: 0, planned_end: 50 * MIN })).toBe("50m");
  });
});
