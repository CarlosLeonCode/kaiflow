import { describe, expect, it } from "vitest";

import { parseHex, rgbToHsl, tuneCategoryColor } from "./color";

function lightnessOf(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) throw new Error("bad hex");
  return rgbToHsl(rgb)[2];
}

describe("parseHex", () => {
  it("reads short and long forms", () => {
    expect(parseHex("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex("#0A64D8")).toEqual({ r: 10, g: 100, b: 216 });
  });

  it("rejects anything else", () => {
    expect(parseHex("blue")).toBeNull();
    expect(parseHex("#12")).toBeNull();
    expect(parseHex("")).toBeNull();
  });
});

describe("tuneCategoryColor", () => {
  it("darkens pale colors on the light theme", () => {
    expect(lightnessOf(tuneCategoryColor("#fff2a8", false))).toBeLessThanOrEqual(0.51);
  });

  it("lightens deep colors on the dark theme", () => {
    expect(lightnessOf(tuneCategoryColor("#101a40", true))).toBeGreaterThanOrEqual(0.59);
  });

  it("keeps the hue of a color that is already inside the band", () => {
    const [hueBefore] = rgbToHsl(parseHex("#2f7de1") ?? { r: 0, g: 0, b: 0 });
    const [hueAfter] = rgbToHsl(parseHex(tuneCategoryColor("#2f7de1", false)) ?? { r: 0, g: 0, b: 0 });
    expect(Math.abs(hueBefore - hueAfter)).toBeLessThan(3);
  });

  it("falls back to a neutral gray for invalid input", () => {
    expect(tuneCategoryColor("not-a-color", false)).toBe("#6b7280");
    expect(tuneCategoryColor("", true)).toBe("#9ca3af");
  });

  it("always returns a 7 character hex", () => {
    for (const input of ["#000", "#fff", "#9ca3af", "#ff0000", "#00ff00"]) {
      expect(tuneCategoryColor(input, true)).toMatch(/^#[0-9a-f]{6}$/);
      expect(tuneCategoryColor(input, false)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
