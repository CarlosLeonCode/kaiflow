import { describe, expect, it } from "vitest";

import { tuneCategoryColor } from "@/shared/lib/color";

import { DEFAULT_COLOR, PRESET_COLORS, presetFor, suggestColor } from "./palette";

describe("palette", () => {
  it("offers distinct presets that stay readable in both themes", () => {
    expect(new Set(PRESET_COLORS.map((p) => p.hex)).size).toBe(PRESET_COLORS.length);
    for (const preset of PRESET_COLORS) {
      for (const dark of [false, true]) expect(tuneCategoryColor(preset.hex, dark)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("suggests the first unused preset", () => {
    expect(suggestColor([])).toBe(DEFAULT_COLOR);
    expect(suggestColor([DEFAULT_COLOR.toUpperCase()])).toBe(PRESET_COLORS[1]?.hex);
    expect(suggestColor(PRESET_COLORS.map((p) => p.hex))).toBe(DEFAULT_COLOR);
  });

  it("recognizes a preset case-insensitively", () => {
    expect(presetFor("#3B82F6")?.name).toBe("Blue");
    expect(presetFor("#123456")).toBeUndefined();
  });
});
