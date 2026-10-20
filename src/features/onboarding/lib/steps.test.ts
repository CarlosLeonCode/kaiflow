import { describe, expect, it } from "vitest";

import { buildSummary, nextStep, previousStep, shouldOfferRestart } from "./steps";

describe("steps", () => {
  it("moves within bounds", () => {
    expect(nextStep("welcome")).toBe("access");
    expect(nextStep("ready")).toBe("ready");
    expect(previousStep("access")).toBe("welcome");
    expect(previousStep("welcome")).toBe("welcome");
  });
});

describe("shouldOfferRestart", () => {
  it("only after access flipped from missing to granted", () => {
    expect(shouldOfferRestart(true, "granted")).toBe(true);
    expect(shouldOfferRestart(false, "granted")).toBe(false);
    expect(shouldOfferRestart(true, "denied")).toBe(false);
    expect(shouldOfferRestart(true, undefined)).toBe(false);
  });
});

describe("buildSummary", () => {
  it("explains the degraded outcome when titles are wanted but access is missing", () => {
    expect(buildSummary(true, "denied").access).toMatch(/skipped/);
    expect(buildSummary(true, "granted").titles).toBe("App names and window titles");
  });

  it("does not nag when titles are off", () => {
    const summary = buildSummary(false, "denied");
    expect(summary.titles).toBe("App names only");
    expect(summary.access).toBe("Accessibility is not needed");
  });
});
