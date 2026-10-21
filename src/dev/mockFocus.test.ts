import { describe, expect, it } from "vitest";

import type { FocusAppDto, FocusStartDto } from "@/shared/ipc";

import {
  ALERT_COOLDOWN_MS,
  cycleAnswer,
  cycleCompleted,
  cycleStarted,
  emptyCycle,
  observe,
  pause,
  plannedMs,
  remaining,
  resume,
  startProblem,
  summarize,
  type MockSession,
  type MockStep,
} from "./mockFocus";
import type { MockSegment } from "./seed";

const S = 1000;
const MIN = 60 * S;
const DRIFT = 90 * S;

const excel: FocusAppDto = { app_id: "excel", app_name: "Excel", activity_id: 9 };
const slack: FocusAppDto = { app_id: "slack", app_name: "Slack", activity_id: 5 };

function session(): MockSession {
  return {
    id: 1,
    kind: "focus",
    intent: "Write report",
    started_at: 0,
    planned_end: 50 * MIN,
    paused_at: null,
    paused_ms: 0,
    allowed: { activity_ids: [2], app_ids: ["excel"] },
    drift_alerts: 0,
    outside_since: null,
    last_alert: null,
    snoozed_until: null,
    alerting: false,
  };
}

describe("the mock drift rule mirrors the domain", () => {
  it("alerts after the threshold in a row, once", () => {
    const s = session();
    observe(s, slack, 10 * S, DRIFT);
    observe(s, slack, 99 * S, DRIFT);
    expect(s.alerting).toBe(false);
    observe(s, slack, 101 * S, DRIFT);
    expect([s.alerting, s.drift_alerts]).toEqual([true, 1]);
    observe(s, slack, 102 * S, DRIFT);
    expect(s.drift_alerts).toBe(1);
  });

  it("coming back before the threshold raises nothing and resets the timer", () => {
    const s = session();
    observe(s, slack, 0, DRIFT);
    observe(s, excel, 60 * S, DRIFT);
    observe(s, slack, 70 * S, DRIFT);
    observe(s, slack, 150 * S, DRIFT);
    expect(s.alerting).toBe(false);
    observe(s, slack, 161 * S, DRIFT);
    expect(s.alerting).toBe(true);
  });

  it("holds alerts at least five minutes apart and honors a snooze", () => {
    const s = session();
    observe(s, slack, 0, DRIFT);
    observe(s, slack, 91 * S, DRIFT);
    observe(s, excel, 100 * S, DRIFT);
    expect(s.alerting).toBe(false);
    observe(s, slack, 110 * S, DRIFT);
    observe(s, slack, 250 * S, DRIFT);
    expect(s.drift_alerts).toBe(1);
    observe(s, slack, 91 * S + ALERT_COOLDOWN_MS, DRIFT);
    expect(s.drift_alerts).toBe(2);

    const snoozed = session();
    snoozed.snoozed_until = 20 * MIN;
    observe(snoozed, slack, 0, DRIFT);
    observe(snoozed, slack, 10 * MIN, DRIFT);
    expect(snoozed.alerting).toBe(false);
    observe(snoozed, slack, 20 * MIN, DRIFT);
    expect(snoozed.alerting).toBe(true);
  });

  it("suspends the rule when nothing is observed", () => {
    const s = session();
    observe(s, slack, 0, DRIFT);
    observe(s, slack, 91 * S, DRIFT);
    observe(s, null, 100 * S, DRIFT);
    expect([s.alerting, s.outside_since]).toEqual([false, null]);
  });

  it("treats an allowed activity as on target", () => {
    const s = session();
    observe(s, { app_id: "code", app_name: "Code", activity_id: 2 }, 0, DRIFT);
    observe(s, { app_id: "code", app_name: "Code", activity_id: 2 }, 10 * MIN, DRIFT);
    expect(s.alerting).toBe(false);
  });
});

describe("the mock summary", () => {
  const seg = (app: string, start: number, end: number | null): MockSegment => ({
    id: 1,
    started_at: start,
    ended_at: end,
    app_id: app,
    app_name: app.toUpperCase(),
    window_title: null,
    source: "tracked",
    activity_id: null,
    end_reason: null,
  });
  const classify = (s: MockSegment) => (s.app_id === "code" ? 2 : 5);

  it("splits the time, clips to the session and ranks the distractions", () => {
    const result = summarize(
      [seg("excel", 0, 30 * MIN), seg("code", 30 * MIN, 35 * MIN), seg("slack", 35 * MIN, 45 * MIN), seg("mail", 45 * MIN, 60 * MIN)],
      session().allowed,
      classify,
      0,
      50 * MIN,
      60 * MIN,
    );
    expect([result.inside_ms, result.outside_ms, result.percent_inside]).toEqual([35 * MIN, 15 * MIN, 70]);
    expect(result.top_distractions.map((d) => d.app_id)).toEqual(["slack", "mail"]);
  });

  it("has no percentage without tracked time", () => {
    expect(summarize([], session().allowed, classify, 0, MIN, MIN).percent_inside).toBeNull();
  });
});

describe("start validation", () => {
  const start = (changes: Partial<FocusStartDto> = {}): FocusStartDto => ({
    kind: "focus",
    intent: "Write report",
    planned_minutes: 25,
    allowed: { activity_ids: [], app_ids: ["excel"] },
    ...changes,
  });

  it("accepts a good request and explains the bad ones", () => {
    expect(startProblem(start())).toBeNull();
    expect(startProblem(start({ intent: " " }))).toBeNull();
    expect(startProblem(start({ intent: "x".repeat(81) }))).toMatch(/too long/);
    expect(startProblem(start({ planned_minutes: 0 }))).toMatch(/1 minute and 12 hours/);
    expect(startProblem(start({ allowed: { activity_ids: [], app_ids: [] } }))).toMatch(/allow at least one/);
    expect(startProblem(start({ kind: "timer", allowed: { activity_ids: [], app_ids: [] } }))).toBeNull();
  });
});

describe("pause and resume", () => {
  it("freezes the time left and moves the end on resume", () => {
    const s = session();
    pause(s, 10 * MIN);
    expect(remaining(s, 30 * MIN)).toBe(40 * MIN);
    observe(s, slack, 30 * MIN, DRIFT);
    expect(s.outside_since).toBeNull();
    resume(s, 70 * MIN);
    expect([s.planned_end, s.paused_ms, s.paused_at]).toEqual([110 * MIN, 60 * MIN, null]);
    expect(plannedMs(s, 70 * MIN)).toBe(50 * MIN);
  });
});

describe("the mock pomodoro cycle mirrors the domain", () => {
  const timer = {
    cycle_enabled: true,
    short_break_minutes: 5,
    long_break_minutes: 15,
    long_break_every: 2,
    auto_start_next: false,
    sound: true,
    heads_up: false,
  };
  const work: MockStep = { kind: "timer", planned_ms: 25 * MIN, intent: "Read", allowed: { activity_ids: [], app_ids: [] }, long_break: false };

  it("offers a short break, then a long one that closes the cycle", () => {
    const c = emptyCycle();
    cycleStarted(c, work, 0);
    cycleCompleted(c, work, 25 * MIN, timer);
    expect(c.card?.next).toMatchObject({ kind: "break", planned_ms: 5 * MIN, long_break: false });
    const brk = cycleAnswer(c, { kind: "start_next" }, 25 * MIN)!;
    cycleCompleted(c, brk, 30 * MIN, timer);
    expect(c.card?.next).toMatchObject({ kind: "timer", intent: "Read" });
    cycleAnswer(c, { kind: "skip" }, 30 * MIN);
    cycleStarted(c, work, 31 * MIN);
    cycleCompleted(c, work, 56 * MIN, timer);
    expect(c.card?.next).toMatchObject({ long_break: true, planned_ms: 15 * MIN });
    expect(c.round).toBe(2);
    cycleAnswer(c, { kind: "skip" }, 57 * MIN);
    expect(c.round).toBe(0);
  });

  it("more time keeps the offer and counts the round once", () => {
    const c = emptyCycle();
    cycleStarted(c, work, 0);
    cycleCompleted(c, work, 25 * MIN, timer);
    const more = cycleAnswer(c, { kind: "more_time", minutes: 5 }, 25 * MIN)!;
    expect([more.kind, more.planned_ms]).toEqual(["timer", 5 * MIN]);
    cycleCompleted(c, more, 30 * MIN, timer);
    expect(c.card?.next?.kind).toBe("break");
    expect(c.round).toBe(1);
  });
});
