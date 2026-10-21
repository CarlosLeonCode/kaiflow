import { describe, expect, it } from "vitest";

import { appLabel, activityLabel } from "./labels";

describe("labels", () => {
  it("translates the system activity by id, not by name", () => {
    expect(activityLabel(1, "Legacy seeded name")).toBe("Unassigned");
    expect(activityLabel(2, "Work")).toBe("Work");
  });

  it("labels manual assignments and falls back to the bundle id", () => {
    expect(appLabel(null, null)).toBe("Assigned manually");
    expect(appLabel("com.x", "X")).toBe("X");
    expect(appLabel("com.x", null)).toBe("com.x");
  });
});
