import { describe, expect, it } from "vitest";

import type { FocusAppDto, FocusStartDto } from "@/shared/ipc";

import { ALERT_COOLDOWN_MS, observe, startProblem, summarize, type MockSession } from "./mockFocus";
import type { MockSegment } from "./seed";

const S = 1000;
const MIN = 60 * S;
const DRIFT = 90 * S;

const excel: FocusAppDto = { app_id: "excel", app_name: "Excel", activity_id: 9 };
const slack: FocusAppDto = { app_id: "slack", app_name: "Slack", activity_id: 5 };

function session(): MockSession {
  return {
    id: 1,
    intent: "Write report",
    started_at: 0,
    planned_end: 50 * MIN,
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
    intent: "Write report",
    planned_minutes: 25,
    allowed: { activity_ids: [], app_ids: ["excel"] },
    ...changes,
  });

  it("accepts a good request and explains the bad ones", () => {
    expect(startProblem(start())).toBeNull();
    expect(startProblem(start({ intent: " " }))).toMatch(/describe/);
    expect(startProblem(start({ planned_minutes: 0 }))).toMatch(/1 minute and 12 hours/);
    expect(startProblem(start({ allowed: { activity_ids: [], app_ids: [] } }))).toMatch(/allow at least one/);
  });
});
