import { describe, expect, it } from "vitest";

import {
  allowedSummary,
  alertsText,
  countdownText,
  draftMinutes,
  draftKind,
  draftProblem,
  emptyDraft,
  endCardCopy,
  endReasonLabel,
  plannedText,
  progress,
  quickTimer,
  remainingLabel,
  remainingMs,
  roundDots,
  startOf,
  summaryHeadline,
  todayStats,
  toggled,
  type FocusDraft,
} from "./focus";
import type { FocusCardDto, FocusStepDto } from "@/shared/ipc";

const MIN = 60_000;

function draft(changes: Partial<FocusDraft> = {}): FocusDraft {
  return { ...emptyDraft(), intent: "Write report", appIds: ["excel"], ...changes };
}

describe("the start draft", () => {
  it("is valid with just a length: the task and the allowed set are optional", () => {
    expect(draftProblem(draft())).toBeNull();
    expect(draftProblem(draft({ intent: "  ", appIds: [] }))).toBeNull();
  });

  it("explains what is wrong in plain words", () => {
    expect(draftProblem(draft({ intent: "x".repeat(81) }))).toMatch(/under 80 characters/);
  });

  it("is a focus block with something allowed and a plain timer without", () => {
    expect(draftKind(draft())).toBe("focus");
    expect(draftKind(draft({ appIds: [], activityIds: [] }))).toBe("timer");
    expect(startOf(draft({ appIds: [] })).kind).toBe("timer");
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
      kind: "focus",
      intent: "Write report",
      planned_minutes: 90,
      allowed: { activity_ids: [2], app_ids: ["excel"] },
    });
  });

  it("builds a one-click timer", () => {
    expect(quickTimer(25, "  Read ")).toEqual({
      kind: "timer",
      intent: "Read",
      planned_minutes: 25,
      allowed: { activity_ids: [], app_ids: [] },
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
  const session = { started_at: 0, planned_end: 50 * MIN, paused_at: null, planned_ms: 50 * MIN };

  it("never goes below zero and counts down to the end", () => {
    expect(remainingMs(session, 20 * MIN)).toBe(30 * MIN);
    expect(remainingMs(session, 60 * MIN)).toBe(0);
  });

  it("is frozen while paused", () => {
    const paused = { ...session, paused_at: 10 * MIN };
    expect(remainingMs(paused, 45 * MIN)).toBe(40 * MIN);
    expect(progress(paused, 45 * MIN)).toBeCloseTo(0.2);
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

  it("tells how much of the block has passed, pauses excluded", () => {
    expect(progress(session, 0)).toBe(0);
    expect(progress(session, 25 * MIN)).toBe(0.5);
    expect(progress(session, 90 * MIN)).toBe(1);
    // Resumed after a 10-minute pause: the end moved, the planned length did not.
    expect(progress({ planned_end: 60 * MIN, paused_at: null, planned_ms: 50 * MIN }, 35 * MIN)).toBe(0.5);
    expect(progress({ planned_end: 5, paused_at: null, planned_ms: 0 }, 5)).toBe(1);
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

describe("the end card and the cycle", () => {
  const step = (changes: Partial<FocusStepDto> = {}): FocusStepDto => ({
    kind: "focus",
    intent: "Write report",
    planned_ms: 25 * MIN,
    long_break: false,
    ...changes,
  });
  const card = (finished: FocusStepDto, next: FocusStepDto | null): FocusCardDto => ({ finished, ended_at: 0, next });

  it("offers a break after a work block", () => {
    expect(endCardCopy(card(step(), step({ kind: "break", intent: "", planned_ms: 5 * MIN })))).toEqual({
      title: "Focus done",
      prompt: "Take a 5-minute break?",
      startLabel: "Start break",
    });
    expect(endCardCopy(card(step({ kind: "timer" }), step({ kind: "break", intent: "", planned_ms: 15 * MIN, long_break: true }))).prompt).toBe(
      "Take a 15-minute long break?",
    );
  });

  it("offers the next block after a break", () => {
    expect(endCardCopy(card(step({ kind: "break", intent: "" }), step({ planned_ms: 50 * MIN })))).toEqual({
      title: "Break is over",
      prompt: "Ready for another 50 minutes on “Write report”?",
      startLabel: "Start focus",
    });
    expect(endCardCopy(card(step({ kind: "break", intent: "" }), step({ kind: "timer", intent: "" }))).startLabel).toBe("Start timer");
  });

  it("only says the time is up when the cycle is off", () => {
    expect(endCardCopy(card(step({ kind: "timer" }), null))).toMatchObject({ title: "Time is up", startLabel: null });
  });

  it("fills one dot per completed block", () => {
    expect(roundDots(2, 4)).toEqual([true, true, false, false]);
    expect(roundDots(9, 4)).toEqual([true, true, true, true]);
    expect(roundDots(0, 0)).toEqual([false]);
  });

  it("counts today's completed work blocks and the time spent in them", () => {
    const day = 1_000 * MIN;
    const history = [
      { kind: "focus" as const, started_at: day + MIN, end_reason: "completed" as const, worked_ms: 25 * MIN },
      { kind: "timer" as const, started_at: day + 40 * MIN, end_reason: "cancelled" as const, worked_ms: 10 * MIN },
      { kind: "break" as const, started_at: day + 30 * MIN, end_reason: "completed" as const, worked_ms: 5 * MIN },
      { kind: "focus" as const, started_at: day - MIN, end_reason: "completed" as const, worked_ms: 50 * MIN },
    ];
    expect(todayStats(history, day, day + 24 * 60 * MIN)).toEqual({ blocks: 1, focusMs: 35 * MIN });
  });
});
