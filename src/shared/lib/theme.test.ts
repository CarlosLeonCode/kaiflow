import { describe, expect, it } from "vitest";

import { applyTheme, parseTheme, resolveDark } from "./theme";

describe("theme", () => {
  it("falls back to system for unknown values", () => {
    expect(parseTheme(undefined)).toBe("system");
    expect(parseTheme("sepia")).toBe("system");
    expect(parseTheme("dark")).toBe("dark");
  });

  it("resolves light, dark and system", () => {
    expect(resolveDark("light", true)).toBe(false);
    expect(resolveDark("dark", false)).toBe(true);
    expect(resolveDark("system", true)).toBe(true);
    expect(resolveDark("system", false)).toBe(false);
  });

  it("toggles the dark class on the root element", () => {
    applyTheme("dark");
    expect(document.documentElement).toHaveClass("dark");
    applyTheme("light");
    expect(document.documentElement).not.toHaveClass("dark");
  });
});
