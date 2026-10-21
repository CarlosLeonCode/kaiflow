import { describe, expect, it } from "vitest";

import { previewSentence } from "./RulePreview";

const ready = (total_ms: number, windows: number, unassigned_ms: number) =>
  ({ status: "ready", preview: { total_ms, windows, unassigned_ms } }) as const;

describe("previewSentence", () => {
  it("says how much time a rule would cover, across how many windows", () => {
    expect(previewSentence(ready(8_100_000, 3, 0), 7)).toBe(
      "This rule would cover 2h 15m from the last 7 days across 3 windows.",
    );
    expect(previewSentence(ready(600_000, 1, 600_000), 7)).toBe(
      "This rule would cover 10m from the last 7 days across 1 window. All of it is Unassigned now.",
    );
    expect(previewSentence(ready(3_600_000, 2, 1_200_000), 7)).toContain("20m of it is Unassigned now.");
  });

  it("covers the empty, loading and failure cases in plain words", () => {
    expect(previewSentence(ready(0, 0, 0), 7)).toBe(
      "This rule would not cover any time from the last 7 days. It still applies to new time.",
    );
    expect(previewSentence({ status: "idle" }, 7)).toContain("Pick an app or type some text");
    expect(previewSentence({ status: "loading" }, 7)).toBe("Checking the last 7 days…");
    expect(previewSentence({ status: "invalid" }, 7)).toContain("not complete yet");
    expect(previewSentence({ status: "error" }, 7)).toContain("You can still add the rule.");
  });
});
