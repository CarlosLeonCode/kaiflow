import { describe, expect, it } from "vitest";

import { en, es } from "@/shared/i18n";
import type { AiProviderInfoDto, AiSettingsDto, FocusSessionDto, GoalWeekDto } from "@/shared/ipc";
import { focusSession, goal } from "@/test/ipc";

import {
  activeProvider,
  bytesLabel,
  destinationText,
  focusWeek,
  focusWeekLine,
  goalWeekLine,
  missingKey,
  titlesText,
  weekLabel,
} from "./review";

const HOUR = 3_600_000;

function week(overrides: Partial<GoalWeekDto> = {}): GoalWeekDto {
  return {
    goal: goal({ period: "daily", target_ms: 2 * HOUR }),
    periods: [],
    met: 0,
    missed: 0,
    current_streak: 0,
    best_streak: 0,
    ...overrides,
  };
}

function provider(overrides: Partial<AiProviderInfoDto> = {}): AiProviderInfoDto {
  return {
    provider: "anthropic",
    label: "Anthropic (Claude)",
    needs_key: true,
    local: false,
    default_model: "claude-haiku-5-5",
    model: "claude-haiku-5-5",
    enabled: true,
    consented_at: 1,
    has_key: true,
    base_url: null,
    ...overrides,
  };
}

function settings(overrides: Partial<AiProviderInfoDto> = {}): AiSettingsDto {
  return {
    selected: "anthropic",
    include_titles: false,
    monday_review: false,
    last_auto_error: null,
    providers: [provider(overrides)],
    secret_store: { available: true, reason: null },
  };
}

describe("goalWeekLine", () => {
  it("counts the active days of a daily goal that were met", () => {
    const periods = [
      { start_day: 1, actual_ms: 3 * HOUR, result: "met" as const },
      { start_day: 2, actual_ms: HOUR, result: "missed" as const },
      { start_day: 3, actual_ms: 0, result: "inactive" as const },
      { start_day: 4, actual_ms: 0, result: "in_progress" as const },
    ];
    expect(goalWeekLine(week({ periods, met: 1, missed: 1 }), en)).toBe("Met on 1 of 2 active days.");
    expect(goalWeekLine(week({ periods: [periods[3]!] }), en)).toBe("No active day has ended yet.");
  });

  it("describes a weekly goal by its total against the target", () => {
    const weekly = week({ goal: goal({ period: "weekly", target_ms: 20 * HOUR }) });
    expect(goalWeekLine({ ...weekly, periods: [{ start_day: 1, actual_ms: 22 * HOUR, result: "met" }] }, en)).toBe(
      "Met this week: 22h 00m of 20h 00m.",
    );
    expect(goalWeekLine({ ...weekly, periods: [{ start_day: 1, actual_ms: 6 * HOUR, result: "missed" }] }, en)).toBe(
      "Missed this week: 6h 00m of 20h 00m.",
    );
  });
});

describe("focusWeek", () => {
  const sessions: FocusSessionDto[] = [
    focusSession({ id: 1, percent_inside: 80, drift_alerts: 1 }),
    focusSession({ id: 2, percent_inside: 60, drift_alerts: 2, end_reason: "cancelled" }),
    focusSession({ id: 3, percent_inside: null, drift_alerts: 0 }),
  ];

  it("summarizes the sessions of the week", () => {
    const summary = focusWeek(sessions);
    expect(summary).toMatchObject({ count: 3, completed: 2, driftAlerts: 3, averageInside: 70 });
    expect(focusWeekLine(summary, en)).toBe("3 sessions (2 completed) · 3h 00m planned · 70% on target · 3 nudges.");
  });

  it("says so when there were none", () => {
    expect(focusWeekLine(focusWeek([]), en)).toBe("No focus sessions this week.");
    expect(focusWeek([]).averageInside).toBeNull();
  });
});

describe("what will be sent", () => {
  it("says where the data goes and whether titles are part of it", () => {
    expect(destinationText({ local: true, provider: "ollama", model: "llama3.2" }, "Ollama", en)).toContain("Nothing leaves it");
    expect(destinationText({ local: false, provider: "openai", model: "gpt-6-luna" }, "OpenAI", en)).toContain(
      "over the internet to OpenAI",
    );
    expect(titlesText({ included_titles: false, title_count: 0 }, en)).toBe("Window titles are not included.");
    expect(titlesText({ included_titles: true, title_count: 1 }, en)).toContain("1 window title,");
    expect(titlesText({ included_titles: true, title_count: 0 }, en)).toContain("none were recorded");
  });

  it("formats sizes", () => {
    expect(bytesLabel(900, en)).toBe("900 bytes");
    expect(bytesLabel(2048, en)).toBe("2.0 KB");
  });
});

describe("Spanish", () => {
  it("writes the week in Spanish", () => {
    const weekly = week({ goal: goal({ period: "weekly", target_ms: 20 * HOUR }) });
    expect(goalWeekLine({ ...weekly, periods: [{ start_day: 1, actual_ms: 22 * HOUR, result: "met" }] }, es)).toBe(
      "Cumplido esta semana: 22h 00m de 20h 00m.",
    );
    expect(focusWeekLine(focusWeek([focusSession({ drift_alerts: 1, percent_inside: 75 })]), es)).toBe(
      "1 sesión (1 completada) · 1h 00m previstos · 75 % en la tarea · 1 aviso.",
    );
    expect(weekLabel("2026-10-12 to 2026-10-18", es)).toBe("2026-10-12 a 2026-10-18");
    expect(weekLabel("Week 42", es)).toBe("Week 42");
  });
});

describe("activeProvider", () => {
  it("is null until the selected provider is switched on", () => {
    expect(activeProvider(undefined)).toBeNull();
    expect(activeProvider(settings({ enabled: false }))).toBeNull();
    expect(activeProvider(settings())?.provider).toBe("anthropic");
  });

  it("flags a missing key only for providers that use one", () => {
    expect(missingKey(provider({ has_key: false }))).toBe(true);
    expect(missingKey(provider({ needs_key: false, has_key: false }))).toBe(false);
  });
});
