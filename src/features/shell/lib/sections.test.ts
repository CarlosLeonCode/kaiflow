import { describe, expect, it } from "vitest";

import { isReservedShortcut, sectionForShortcut, type ShortcutEvent } from "./sections";

function key(k: string, mods: Partial<ShortcutEvent> = {}): ShortcutEvent {
  return { key: k, metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, ...mods };
}

describe("sectionForShortcut", () => {
  it("maps ⌘1..⌘7 in sidebar order", () => {
    expect(["1", "2", "3", "4", "5", "6", "7"].map((d) => sectionForShortcut(key(d)))).toEqual([
      "today",
      "overview",
      "goals",
      "focus",
      "activities",
      "privacy",
      "settings",
    ]);
  });

  it("ignores other digits and modified combinations", () => {
    expect(sectionForShortcut(key("8"))).toBeNull();
    expect(sectionForShortcut(key("1", { metaKey: false }))).toBeNull();
    expect(sectionForShortcut(key("1", { shiftKey: true }))).toBeNull();
    expect(sectionForShortcut(key("1", { altKey: true }))).toBeNull();
  });
});

describe("isReservedShortcut", () => {
  it("claims plain ⌘K only", () => {
    expect(isReservedShortcut(key("k"))).toBe(true);
    expect(isReservedShortcut(key("K"))).toBe(true);
    expect(isReservedShortcut(key("k", { shiftKey: true }))).toBe(false);
    expect(isReservedShortcut(key("k", { metaKey: false }))).toBe(false);
  });
});
