import { describe, expect, it } from "vitest";

import { applySummary, exampleApps } from "./presets";

describe("exampleApps", () => {
  it("capitalizes and joins the hints", () => {
    expect(exampleApps({ example_apps: ["figma", "sketch"] })).toBe("Figma, Sketch");
    expect(exampleApps({ example_apps: [] })).toBe("");
  });
});

describe("applySummary", () => {
  it("says what was created, with plurals", () => {
    expect(applySummary("Design", { activities_created: 2, rules_created: 1 })).toBe(
      "Design: added 2 activities and 1 rule for apps you already used.",
    );
    expect(applySummary("Design", { activities_created: 1, rules_created: 0 })).toBe("Design: added 1 activity.");
  });

  it("says when nothing changed (applying twice)", () => {
    expect(applySummary("Design", { activities_created: 0, rules_created: 0 })).toBe(
      "Design was already set up: nothing changed.",
    );
  });
});
