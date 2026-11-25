import { describe, expect, it } from "vitest";

import { en, es } from "@/shared/i18n";

import type { GoalDto, GoalStatusDto } from "@/shared/ipc";
import { HOUR, MINUTE } from "@/shared/lib/time";

import {
  ALL_DAYS,
  WEEKDAYS,
  WEEKEND,
  barPercent,
  bestStreakText,
  daysPhrase,
  draftOf,
  draftProblem,
  emptyDraft,
  formatAmount,
  goalOf,
  goalSentence,
  maxTargetMs,
  partsFromMs,
  remainingText,
  stateLabel,
  streakText,
  suggestedLabel,
  topGoals,
  withLiveTime,
} from "./goals";

const names = {
  activity: (id: number) => (id === 2 ? "Deep work" : `Activity ${id}`),
  app: (id: string) => (id === "mail" ? "Mail" : id),
};

function goal(overrides: Partial<GoalDto> = {}): GoalDto {
  return {
    id: 1,
    label: "Deep work",
    scope: { kind: "activity", activity_id: 2 },
    period: "daily",
    kind: "minimum",
    target_ms: 4 * HOUR,
    active_days: WEEKDAYS,
    archived: false,
    ...overrides,
  };
}

function status(overrides: Partial<GoalStatusDto> = {}, goalOverrides: Partial<GoalDto> = {}): GoalStatusDto {
  return {
    goal: goal(goalOverrides),
    period: { from: 0, to: 1 },
    actual_ms: HOUR,
    target_ms: 4 * HOUR,
    percent: 25,
    state: "pending",
    active: true,
    streak: { current: 0, best: 0, at_risk: false },
    unseen: null,
    ...overrides,
  };
}

describe("amounts", () => {
  it("formats compactly", () => {
    expect(formatAmount(4 * HOUR)).toBe("4h");
    expect(formatAmount(90 * MINUTE)).toBe("1h 30m");
    expect(formatAmount(45 * MINUTE)).toBe("45m");
    expect(formatAmount(0)).toBe("0m");
  });

  it("splits milliseconds into hours and minutes", () => {
    expect(partsFromMs(150 * MINUTE)).toEqual({ hours: 2, minutes: 30 });
  });

  it("limits a target to the length of its period", () => {
    expect(maxTargetMs("daily")).toBe(24 * HOUR);
    expect(maxTargetMs("weekly")).toBe(7 * 24 * HOUR);
    expect(maxTargetMs("monthly")).toBe(31 * 24 * HOUR);
  });
});

describe("plain language", () => {
  it("says which days a daily goal covers", () => {
    expect(daysPhrase(ALL_DAYS, en)).toBe("every day");
    expect(daysPhrase(WEEKDAYS, en)).toBe("every weekday");
    expect(daysPhrase(WEEKEND, en)).toBe("every weekend day");
    expect(daysPhrase(0b0010101, en)).toBe("on Mon, Wed and Fri");
    expect(daysPhrase(0b0000100, en)).toBe("every Wed");
  });

  it("describes a minimum on an activity", () => {
    expect(goalSentence(goal(), names, en)).toBe("At least 4h of Deep work every weekday.");
  });

  it("describes a maximum on an app and the other scopes and periods", () => {
    expect(
      goalSentence(goal({ kind: "maximum", scope: { kind: "app", app_id: "mail" }, target_ms: 30 * MINUTE, active_days: ALL_DAYS }), names, en),
    ).toBe("No more than 30m in Mail every day.");
    expect(goalSentence(goal({ scope: { kind: "total" }, period: "weekly", target_ms: 20 * HOUR }), names, en)).toBe(
      "At least 20h of tracked time every week.",
    );
    expect(goalSentence(goal({ period: "monthly" }), names, en)).toBe("At least 4h of Deep work every month.");
  });

  it("suggests a short name", () => {
    expect(suggestedLabel(goal(), names, en)).toBe("Deep work, at least 4h daily");
    expect(suggestedLabel(goal({ kind: "maximum", scope: { kind: "total" }, period: "weekly" }), names, en)).toBe(
      "All time, at most 4h weekly",
    );
  });

  it("says the same in Spanish", () => {
    expect(goalSentence(goal(), names, es)).toBe("Al menos 4h de Deep work de lunes a viernes.");
    expect(daysPhrase(0b0010101, es)).toBe("los lunes, miércoles y viernes");
    expect(daysPhrase(0b0100000, es)).toBe("los sábados");
    expect(suggestedLabel(goal({ kind: "maximum", scope: { kind: "total" }, period: "weekly" }), names, es)).toBe(
      "Todo el tiempo, como máximo 4h a la semana",
    );
    expect(streakText({ current: 1, best: 1, at_risk: false }, "weekly", es)).toBe("1 semana seguida");
    expect(streakText({ current: 3, best: 3, at_risk: false }, "monthly", es)).toBe("3 meses seguidos");
  });
});

describe("streaks and state", () => {
  it("pluralizes by period", () => {
    expect(streakText({ current: 1, best: 3, at_risk: false }, "daily", en)).toBe("1 day in a row");
    expect(streakText({ current: 5, best: 5, at_risk: false }, "weekly", en)).toBe("5 weeks in a row");
    expect(streakText({ current: 0, best: 3, at_risk: false }, "daily", en)).toBeNull();
    expect(bestStreakText({ current: 0, best: 3, at_risk: false }, "monthly", en)).toBe("Best: 3 months");
    expect(bestStreakText({ current: 0, best: 0, at_risk: false }, "monthly", en)).toBeNull();
  });

  it("labels each state and a rest day", () => {
    expect(stateLabel(status({ state: "reached" }), en).label).toBe("Goal reached");
    expect(stateLabel(status({ state: "exceeded" }, { kind: "maximum" }), en).tone).toBe("warning");
    expect(stateLabel(status({}, { kind: "maximum" }), en).label).toBe("Within the limit");
    expect(stateLabel(status(), en).label).toBe("In progress");
    expect(stateLabel(status({ active: false }), en).label).toBe("Rest day");
  });

  it("tells what is left or how far over", () => {
    expect(remainingText(status(), en)).toBe("3h to go");
    expect(remainingText(status({ actual_ms: 5 * HOUR }), en)).toBe("Target met");
    expect(remainingText(status({ actual_ms: HOUR, target_ms: 2 * HOUR }, { kind: "maximum", target_ms: 2 * HOUR }), en)).toBe("1h left");
    expect(remainingText(status({ actual_ms: 150 * MINUTE, target_ms: 2 * HOUR }, { kind: "maximum", target_ms: 2 * HOUR }), en)).toBe("30m over");
  });

  it("caps the bar at the full width", () => {
    expect(barPercent(status({ percent: 250 }))).toBe(100);
    expect(barPercent(status({ percent: 40 }))).toBe(40);
  });

  it("puts unseen crossings first, then goals still in progress", () => {
    const rows = [
      status({ state: "reached" }, { id: 1 }),
      status({}, { id: 2 }),
      status({ unseen: "exceeded" }, { id: 3 }),
      status({ active: false }, { id: 4 }),
    ];
    expect(topGoals(rows, 2).map((s) => s.goal.id)).toEqual([3, 2]);
    expect(topGoals(rows, 10).map((s) => s.goal.id)).toEqual([3, 2, 1, 4]);
  });
});

describe("drafts", () => {
  it("validates what the form accepts", () => {
    const base = { ...emptyDraft({ kind: "total" }), hours: 2 };
    expect(draftProblem(base, en)).toBeNull();
    expect(draftProblem({ ...base, hours: 0, minutes: 0 }, en)).toMatch(/longer than zero/);
    expect(draftProblem({ ...base, minutes: 75 }, en)).toMatch(/minutes from 0 to 59/);
    expect(draftProblem({ ...base, hours: 25 }, en)).toMatch(/one day/);
    expect(draftProblem({ ...base, period: "weekly", hours: 25 }, en)).toBeNull();
    expect(draftProblem({ ...base, days: 0 }, en)).toMatch(/active day/);
    expect(draftProblem({ ...base, scope: { kind: "app", app_id: "" } }, en)).toMatch(/Choose an app/);
    expect(draftProblem({ ...base, label: "x".repeat(61) }, en)).toMatch(/at most 60/);
  });

  it("round trips a goal through its draft", () => {
    const original = goal({ id: 7, target_ms: 90 * MINUTE });
    expect(goalOf(draftOf(original), names, en, 7)).toEqual(original);
  });

  it("names an unnamed goal and ignores the days of non-daily goals", () => {
    const draft = { ...emptyDraft({ kind: "activity", activity_id: 2 }), hours: 3, period: "weekly" as const, days: WEEKEND };
    const made = goalOf(draft, names, en);
    expect(made.label).toBe("Deep work, at least 3h weekly");
    expect(made.active_days).toBe(ALL_DAYS);
    expect(made.id).toBe(0);
  });
});

describe("live time", () => {
  const focus = { app_id: "mail", activity_id: 2 };

  it("adds the open segment to the goals it counts for and nothing else", () => {
    const rows = [
      status({}, { id: 1 }),
      status({}, { id: 2, scope: { kind: "app", app_id: "mail" } }),
      status({}, { id: 3, scope: { kind: "app", app_id: "other" } }),
      status({}, { id: 4, scope: { kind: "total" } }),
      status({ active: false }, { id: 5 }),
    ];
    const live = withLiveTime(rows, focus, 30 * MINUTE);
    expect(live.map((s) => s.actual_ms / MINUTE)).toEqual([90, 90, 60, 90, 60]);
    expect(live[0]?.percent).toBe(37);
  });

  it("flips a minimum to reached, extends the streak once and exceeds a maximum", () => {
    const minimum = status({ actual_ms: 3.9 * HOUR, streak: { current: 2, best: 5, at_risk: true } });
    const [done] = withLiveTime([minimum], focus, 10 * MINUTE);
    expect(done?.state).toBe("reached");
    expect(done?.streak).toEqual({ current: 3, best: 5, at_risk: false });
    // Already reached: the streak does not grow again.
    const [again] = withLiveTime([{ ...minimum, state: "reached" }], focus, 10 * MINUTE);
    expect(again?.streak.current).toBe(2);

    const maximum = status({ actual_ms: 59 * MINUTE, target_ms: HOUR }, { kind: "maximum", target_ms: HOUR });
    expect(withLiveTime([maximum], focus, 30 * 1000)[0]?.state).toBe("pending");
    expect(withLiveTime([maximum], focus, 2 * MINUTE)[0]?.state).toBe("exceeded");
  });

  it("does nothing without a live segment, or for unknown activities", () => {
    const rows = [status()];
    expect(withLiveTime(rows, null, HOUR)).toBe(rows);
    expect(withLiveTime(rows, focus, 0)).toBe(rows);
    expect(withLiveTime(rows, { app_id: "mail", activity_id: null }, HOUR)[0]?.actual_ms).toBe(HOUR);
  });
});
