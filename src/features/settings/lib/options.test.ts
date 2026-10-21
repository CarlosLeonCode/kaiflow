import { describe, expect, it } from "vitest";

import {
  TRAY_DISPLAY_OPTIONS,
  autoDiscardOptions,
  formatThreshold,
  idleThresholdOptions,
  parseTrayDisplay,
  promptTimeoutOptions,
} from "./options";

describe("idle threshold options", () => {
  it("offers the presets in ascending order", () => {
    const options = idleThresholdOptions(300);
    expect(options.map((o) => o.label)).toEqual([
      "1 min", "2 min", "3 min", "5 min", "10 min", "15 min", "20 min", "30 min", "1 hour",
    ]);
  });

  it("keeps an unusual stored value selectable", () => {
    const options = idleThresholdOptions(450);
    expect(options.find((o) => o.secs === 450)?.label).toBe("450 sec");
    expect(options.map((o) => o.secs)).toEqual([...options.map((o) => o.secs)].sort((a, b) => a - b));
  });

  it("formats hours, minutes and seconds", () => {
    expect(formatThreshold(7200)).toBe("2 hours");
    expect(formatThreshold(90)).toBe("90 sec");
  });
});

describe("menu bar display options", () => {
  it("offers every backend variant once, icon only first", () => {
    expect(TRAY_DISPLAY_OPTIONS.map((o) => o.value)).toEqual(["off", "today_total", "current_app", "today_and_current"]);
  });

  it("falls back to today's total for unknown values", () => {
    expect(parseTrayDisplay("current_app")).toBe("current_app");
    expect(parseTrayDisplay("neon")).toBe("today_total");
  });
});

describe("idle policy options", () => {
  it("offers Always ask first and keeps a stored value selectable", () => {
    const options = autoDiscardOptions(120);
    expect(options[0]).toEqual({ secs: 0, label: "Always ask" });
    expect(options.find((o) => o.secs === 120)?.label).toBe("Shorter than 2 min");
    expect(autoDiscardOptions(45).some((o) => o.secs === 45)).toBe(true);
  });

  it("lists prompt timeouts in ascending order with the stored one", () => {
    const secs = promptTimeoutOptions(90).map((o) => o.secs);
    expect(secs).toContain(90);
    expect(secs).toEqual([...secs].sort((a, b) => a - b));
  });
});
