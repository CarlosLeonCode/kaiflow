import { describe, expect, it } from "vitest";

import { appLabel, categoryLabel } from "./labels";

describe("labels", () => {
  it("translates the system category by id, not by name", () => {
    expect(categoryLabel(1, "Sin categoría")).toBe("Uncategorized");
    expect(categoryLabel(2, "Work")).toBe("Work");
  });

  it("labels manual assignments and falls back to the bundle id", () => {
    expect(appLabel(null, null)).toBe("Assigned manually");
    expect(appLabel("com.x", "X")).toBe("X");
    expect(appLabel("com.x", null)).toBe("com.x");
  });
});
