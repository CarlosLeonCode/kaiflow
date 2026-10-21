import { describe, expect, it } from "vitest";

import { containsPattern, containsText } from "./titleMatch";

describe("title contains matching", () => {
  it("stores plain text as a case-insensitive pattern with special characters escaped", () => {
    expect(containsPattern("YouTube")).toBe("(?i)YouTube");
    expect(containsPattern("Budget (Q3) v1.2 + notes?")).toBe("(?i)Budget \\(Q3\\) v1\\.2 \\+ notes\\?");
  });

  it("matches the text literally, ignoring case", () => {
    const pattern = containsPattern("v1.2 (draft)");
    const regex = new RegExp(pattern.slice(4), "i");
    expect(regex.test("Report V1.2 (Draft) - Excel")).toBe(true);
    expect(regex.test("Report v1x2 draft")).toBe(false);
  });

  it("recognizes its own patterns and nothing else", () => {
    for (const text of ["YouTube", "a.b|c", "C:\\path", "100% [done] {x} ^$"]) {
      expect(containsText(containsPattern(text))).toBe(text);
    }
    expect(containsText("Figma|Sketch")).toBeNull();
    expect(containsText("(?i)Figma|Sketch")).toBeNull();
    expect(containsText("(?i)\\d+")).toBeNull();
    expect(containsText("(?i)")).toBeNull();
  });
});
