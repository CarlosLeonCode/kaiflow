import { describe, expect, it } from "vitest";

import { en, es } from "@/shared/i18n";

import {
  TRAY_DISPLAY_VALUES,
  autoDiscardOptions,
  formatThreshold,
  idleThresholdOptions,
  parseTrayDisplay,
  promptTimeoutOptions,
  trayDisplayOptions,
  weekStartOptions,
} from "./options";

describe("idle threshold options", () => {
  it("offers the presets in ascending order", () => {
    const options = idleThresholdOptions(300, en);
    expect(options.map((o) => o.label)).toEqual([
      "1 min", "2 min", "3 min", "5 min", "10 min", "15 min", "20 min", "30 min", "1 hour",
    ]);
  });

  it("keeps an unusual stored value selectable", () => {
    const options = idleThresholdOptions(450, en);
    expect(options.find((o) => o.secs === 450)?.label).toBe("450 sec");
    expect(options.map((o) => o.secs)).toEqual([...options.map((o) => o.secs)].sort((a, b) => a - b));
  });

  it("formats hours, minutes and seconds", () => {
    expect(formatThreshold(7200, en)).toBe("2 hours");
    expect(formatThreshold(90, en)).toBe("90 sec");
    expect(formatThreshold(7200, es)).toBe("2 horas");
    expect(formatThreshold(90, es)).toBe("90 s");
  });
});

describe("menu bar display options", () => {
  it("offers every backend variant once, icon only first", () => {
    expect(TRAY_DISPLAY_VALUES).toEqual(["off", "today_total", "current_app", "today_and_current", "goal_progress"]);
  });

  it("falls back to today's total for unknown values", () => {
    expect(parseTrayDisplay("current_app")).toBe("current_app");
    expect(parseTrayDisplay("neon")).toBe("today_total");
  });

  it("labels every choice in the active language", () => {
    expect(trayDisplayOptions(en)[0]?.label).toBe("Icon only");
    expect(trayDisplayOptions(es)[0]?.label).toBe("Solo el icono");
    expect(weekStartOptions(0, es).map((o) => o.label)).toEqual(["Lunes", "Sábado", "Domingo"]);
  });
});

describe("idle policy options", () => {
  it("offers Always ask first and keeps a stored value selectable", () => {
    const options = autoDiscardOptions(120, en);
    expect(options[0]).toEqual({ secs: 0, label: "Always ask" });
    expect(options.find((o) => o.secs === 120)?.label).toBe("Shorter than 2 min");
    expect(autoDiscardOptions(45, en).some((o) => o.secs === 45)).toBe(true);
  });

  it("lists prompt timeouts in ascending order with the stored one", () => {
    const secs = promptTimeoutOptions(90, en).map((o) => o.secs);
    expect(secs).toContain(90);
    expect(secs).toEqual([...secs].sort((a, b) => a - b));
  });
});
