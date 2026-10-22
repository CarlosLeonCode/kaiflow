import { describe, expect, it } from "vitest";

import {
  isReservedShortcut,
  sectionAriaShortcut,
  sectionForShortcut,
  sectionShortcutLabel,
  type ShortcutEvent,
} from "./sections";

function key(k: string, mods: Partial<ShortcutEvent> = {}): ShortcutEvent {
  return { key: k, metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, ...mods };
}

describe("sectionForShortcut", () => {
  it("maps ⌘1..⌘8 in sidebar order", () => {
    expect(["1", "2", "3", "4", "5", "6", "7", "8"].map((d) => sectionForShortcut(key(d)))).toEqual([
      "today",
      "overview",
      "goals",
      "focus",
      "review",
      "activities",
      "privacy",
      "settings",
    ]);
  });

  it("ignores other digits and modified combinations", () => {
    expect(sectionForShortcut(key("9"))).toBeNull();
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

describe("off macOS", () => {
  const ctrl = (k: string, mods: Partial<ShortcutEvent> = {}) => key(k, { metaKey: false, ctrlKey: true, ...mods });

  it("uses Ctrl instead of Command", () => {
    expect(sectionForShortcut(ctrl("2"), "windows")).toBe("overview");
    expect(sectionForShortcut(ctrl("8"), "linux")).toBe("settings");
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
