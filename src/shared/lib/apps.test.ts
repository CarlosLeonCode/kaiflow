import { describe, expect, it } from "vitest";

import { appName, appOptions } from "./apps";

describe("appOptions", () => {
  it("lists seen apps by name without duplicates and skips manual time", () => {
    const options = appOptions([
      { app_id: "com.zed", app_name: "Zed", total_ms: 1 },
      { app_id: null, app_name: "Asignado manualmente", total_ms: 5 },
      { app_id: "com.apple.dt.Xcode", app_name: "xcode", total_ms: 1 },
    ]);
    expect(options).toEqual([
      { id: "com.apple.dt.Xcode", name: "xcode" },
      { id: "com.zed", name: "Zed" },
    ]);
  });

  it("adds ids that only appear elsewhere (rules) using the id as their name", () => {
    const options = appOptions([{ app_id: "a.b", app_name: "AB", total_ms: 1 }], ["a.b", "old.App"]);
    expect(options).toEqual([
      { id: "a.b", name: "AB" },
      { id: "old.App", name: "old.App" },
    ]);
    expect(appName(options, "old.App")).toBe("old.App");
    expect(appName(options, "missing")).toBe("missing");
    expect(appName(options, "a.b")).toBe("AB");
  });
});
