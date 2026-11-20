import { describe, expect, it } from "vitest";

import { en, es } from "@/shared/i18n";

import { DEFAULT_PRODUCTIVITY, PRODUCTIVITY_VALUES, productivityLabel, productivityOptions } from "./productivity";

describe("productivity options", () => {
  it("defaults to neutral and labels every value", () => {
    expect(DEFAULT_PRODUCTIVITY).toBe("neutral");
    expect(PRODUCTIVITY_VALUES).toEqual(["productive", "neutral", "distracting"]);
    expect(productivityOptions(es).map((o) => o.label)).toEqual(["Productivo", "Neutral", "Distracción"]);
    expect(productivityLabel("distracting", en)).toBe("Distracting");
  });
});
