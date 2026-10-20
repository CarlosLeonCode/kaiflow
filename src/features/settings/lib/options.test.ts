import { describe, expect, it } from "vitest";

import { formatThreshold, idleThresholdOptions } from "./options";

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
