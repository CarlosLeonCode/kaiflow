import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { applyTheme, parseTheme, resolveDark, useIsDark } from "./theme";

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

describe("useIsDark", () => {
  it("follows the dark class on <html>", async () => {
    const { result } = renderHook(() => useIsDark());
    expect(result.current).toBe(false);
    await act(async () => {
      document.documentElement.classList.add("dark");
      await Promise.resolve();
    });
    expect(result.current).toBe(true);
  });
});
