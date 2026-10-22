import { describe, expect, it } from "vitest";

import { platform } from "@/test/ipc";

import { buildSummary, nextStep, previousStep, shouldOfferRestart, stepLabels } from "./steps";

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

describe("per platform", () => {
  it("only macOS has a Permissions step", () => {
    expect(stepLabels(platform("macos")).access).toBe("Permissions");
    expect(stepLabels(platform("windows")).access).toBe("Recording");
    expect(stepLabels(platform("linux", "wayland")).access).toBe("Recording");
  });

  it("never offers a restart outside macOS", () => {
    expect(shouldOfferRestart(true, "granted", platform("windows"))).toBe(false);
    expect(shouldOfferRestart(true, "granted", platform("linux", "x11"))).toBe(false);
    expect(shouldOfferRestart(true, "granted", platform("macos"))).toBe(true);
  });

  it("summarizes without Accessibility on Windows and Linux X11", () => {
    expect(buildSummary(true, "denied", platform("windows"))).toEqual({
      titles: "App names and window titles",
      accessLabel: "Permission",
      access: "None needed",
    });
    expect(buildSummary(false, undefined, platform("linux", "x11")).titles).toBe("App names only");
  });

  it("is honest about Wayland", () => {
    const summary = buildSummary(true, "denied", platform("linux", "wayland"));
    expect(summary.accessLabel).toBe("Window tracking");
    expect(summary.access).toBe("Unavailable on Wayland");
  });
});
