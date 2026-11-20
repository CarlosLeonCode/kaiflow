import { describe, expect, it } from "vitest";

import {
  isReservedShortcut,
  SECTION_GROUPS,
  SECTIONS,
  sectionAriaShortcut,
  sectionForShortcut,
  sectionShortcutLabel,
  type ShortcutEvent,
} from "./sections";

function key(k: string, mods: Partial<ShortcutEvent> = {}): ShortcutEvent {
  return { key: k, metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, ...mods };
}

describe("sectionForShortcut", () => {
  it("maps ⌘1..⌘7 in sidebar order", () => {
    expect(["1", "2", "3", "4", "5", "6", "7"].map((d) => sectionForShortcut(key(d)))).toEqual([
      "today",
      "focus",
      "goals",
      "insights",
      "activities",
      "privacy",
      "settings",
    ]);
  });

  it("ignores other digits and modified combinations", () => {
    expect(sectionForShortcut(key("8"))).toBeNull();
    expect(sectionForShortcut(key("9"))).toBeNull();
    expect(sectionForShortcut(key("1", { metaKey: false }))).toBeNull();
    expect(sectionForShortcut(key("1", { shiftKey: true }))).toBeNull();
    expect(sectionForShortcut(key("1", { altKey: true }))).toBeNull();
  });
});

describe("sidebar groups", () => {
  it("groups the sections as Daily, Look back and Setup", () => {
    expect(
      SECTION_GROUPS.map((group) => [group.label, SECTIONS.filter((s) => s.group === group.id).map((s) => s.label)]),
    ).toEqual([
      ["Daily", ["Today", "Focus", "Goals"]],
      ["Look back", ["Insights"]],
      ["Setup", ["Activities", "Privacy", "Settings"]],
    ]);
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

describe("off macOS", () => {
  const ctrl = (k: string, mods: Partial<ShortcutEvent> = {}) => key(k, { metaKey: false, ctrlKey: true, ...mods });

  it("uses Ctrl instead of Command", () => {
    expect(sectionForShortcut(ctrl("4"), "windows")).toBe("insights");
    expect(sectionForShortcut(ctrl("7"), "linux")).toBe("settings");
    expect(sectionForShortcut(key("2"), "windows")).toBeNull();
    expect(sectionForShortcut(ctrl("2", { metaKey: true }), "linux")).toBeNull();
    expect(isReservedShortcut(ctrl("k"), "windows")).toBe(true);
    // Ctrl+digit stays free on macOS.
    expect(sectionForShortcut(ctrl("2"), "macos")).toBeNull();
  });

  it("labels the keycaps with each platform's convention", () => {
    expect(sectionShortcutLabel("1", "macos")).toBe("⌘1");
    expect(sectionShortcutLabel("1", "windows")).toBe("Ctrl+1");
    expect(sectionAriaShortcut("1", "macos")).toBe("Meta+1");
    expect(sectionAriaShortcut("1", "linux")).toBe("Control+1");
  });
});
