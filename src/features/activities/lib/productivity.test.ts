import { describe, expect, it } from "vitest";

import { DEFAULT_PRODUCTIVITY, PRODUCTIVITY_OPTIONS, productivityLabel } from "./productivity";

describe("productivity options", () => {
  it("defaults to neutral and labels every value", () => {
    expect(DEFAULT_PRODUCTIVITY).toBe("neutral");
    expect(PRODUCTIVITY_OPTIONS.map((o) => o.value)).toEqual(["productive", "neutral", "distracting"]);
    expect(productivityLabel("distracting")).toBe("Distracting");
  });
});
