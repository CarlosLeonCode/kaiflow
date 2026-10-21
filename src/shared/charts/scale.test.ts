import { describe, expect, it } from "vitest";

import { HOUR, MINUTE } from "@/shared/lib/time";

import { niceCeiling } from "./scale";

describe("niceCeiling", () => {
  it("rounds up to a readable axis maximum", () => {
    expect(niceCeiling(0)).toBe(HOUR);
    expect(niceCeiling(4 * MINUTE)).toBe(5 * MINUTE);
    expect(niceCeiling(5 * MINUTE)).toBe(5 * MINUTE);
    expect(niceCeiling(61 * MINUTE)).toBe(120 * MINUTE);
    expect(niceCeiling(7.5 * HOUR)).toBe(8 * HOUR);
  });

  it("keeps whole hours beyond a day", () => {
    expect(niceCeiling(25 * HOUR)).toBe(25 * HOUR);
    expect(niceCeiling(25.2 * HOUR)).toBe(26 * HOUR);
  });
});
