import { describe, expect, it } from "vitest";

import type { RuleDto } from "@/shared/ipc";

import { canMove, moveRule, nameProblem, nameProblemMessage, nextPriority, tierOf } from "./rules";

let nextId = 1;
function rule(kind: "app" | "title_pattern", priority: number, id = nextId++, category = 2): RuleDto {
  return {
    id,
    category_id: category,
    priority,
    spec: kind === "app" ? { kind, app_id: `app.${id}` } : { kind, pattern: `p${id}`, app_id: null },
  };
}

describe("tierOf", () => {
  it("lists a group by priority (highest first), then id", () => {
    const rules = [rule("app", 1, 1), rule("title_pattern", 9, 2), rule("app", 5, 3), rule("app", 5, 4)];
    expect(tierOf(rules, "app").map((r) => r.id)).toEqual([3, 4, 1]);
    expect(tierOf(rules, "title_pattern").map((r) => r.id)).toEqual([2]);
  });
});

describe("nextPriority", () => {
  it("puts a new rule above the top of its own group", () => {
    const rules = [rule("app", 3, 1), rule("title_pattern", 10, 2)];
    expect(nextPriority(rules, "app")).toBe(4);
    expect(nextPriority(rules, "title_pattern")).toBe(11);
    expect(nextPriority([], "app")).toBe(1);
  });
});

describe("moveRule", () => {
  const rules = [rule("app", 3, 1), rule("app", 2, 2), rule("app", 1, 3), rule("title_pattern", 7, 4)];

  it("swaps with the neighbour and renumbers only what changed", () => {
    const changed = moveRule(rules, 2, "up");
    expect(changed.map((r) => [r.id, r.priority]).sort()).toEqual([
      [1, 2],
      [2, 3],
    ]);
  });

  it("applying the result yields the new order", () => {
    const changed = moveRule(rules, 3, "up");
    const applied = rules.map((r) => changed.find((c) => c.id === r.id) ?? r);
    expect(tierOf(applied, "app").map((r) => r.id)).toEqual([1, 3, 2]);
  });

  it("repairs ties so the shown order is the applied order", () => {
    const tied = [rule("app", 5, 1), rule("app", 5, 2), rule("app", 5, 3)];
    const changed = moveRule(tied, 3, "up");
    const applied = tied.map((r) => ({ ...r, ...(changed.find((c) => c.id === r.id) ?? {}) }));
    expect(tierOf(applied, "app").map((r) => r.id)).toEqual([1, 3, 2]);
    expect(new Set(applied.map((r) => r.priority)).size).toBe(3);
  });

  it("does not move past the ends nor across groups, and keeps the category and spec", () => {
    expect(moveRule(rules, 1, "up")).toEqual([]);
    expect(moveRule(rules, 3, "down")).toEqual([]);
    expect(moveRule(rules, 4, "up")).toEqual([]);
    expect(moveRule(rules, 99, "up")).toEqual([]);
    expect(canMove(rules, 1, "up")).toBe(false);
    expect(canMove(rules, 1, "down")).toBe(true);
    const [first] = moveRule(rules, 2, "up");
    expect(first).toMatchObject({ category_id: 2, spec: expect.objectContaining({ kind: "app" }) });
  });
});

describe("nameProblem", () => {
  const existing = [
    { id: 1, name: "Sin categoría" },
    { id: 2, name: "Work" },
  ];

  it("accepts a fresh name and the unchanged name of the category being edited", () => {
    expect(nameProblem("Reading", existing, null)).toBeNull();
    expect(nameProblem("Work", existing, 2)).toBeNull();
  });

  it("rejects empty, too long and duplicate names (case-insensitive, also the system name)", () => {
    expect(nameProblem("   ", existing, null)).toBe("empty");
    expect(nameProblem("x".repeat(41), existing, null)).toBe("too_long");
    expect(nameProblem(" work ", existing, null)).toBe("duplicate");
    expect(nameProblem("uncategorized", existing, null)).toBe("duplicate");
    expect(nameProblem("Work", existing, 5)).toBe("duplicate");
  });

  it("has a message for each problem", () => {
    for (const problem of ["empty", "too_long", "duplicate"] as const) {
      expect(nameProblemMessage(problem).length).toBeGreaterThan(5);
    }
  });
});
