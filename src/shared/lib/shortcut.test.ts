import { describe, expect, it } from "vitest";

import {
  defaultShortcut,
  formatShortcut,
  shortcutFromKeyEvent,
  shortcutKeys,
  type KeyLike,
} from "./shortcut";

function press(code: string, mods: Partial<KeyLike> = {}): KeyLike {
  return { key: code, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods };
}

describe("shortcutFromKeyEvent", () => {
  it("builds the symbol form in the macOS modifier order", () => {
    expect(
      shortcutFromKeyEvent(press("KeyT", { metaKey: true, ctrlKey: true, altKey: true })),
    ).toBe("⌃⌥⌘T");
    expect(shortcutFromKeyEvent(press("Digit1", { metaKey: true, shiftKey: true }))).toBe("⇧⌘1");
    expect(shortcutFromKeyEvent(press("F5", { ctrlKey: true }))).toBe("⌃F5");
    expect(shortcutFromKeyEvent(press("Space", { altKey: true }))).toBe("⌥Space");
  });

  it("requires a real modifier (shift alone would hijack typing)", () => {
    expect(shortcutFromKeyEvent(press("KeyT"))).toBeNull();
    expect(shortcutFromKeyEvent(press("KeyT", { shiftKey: true }))).toBeNull();
  });

  it("ignores modifier-only and unsupported keys", () => {
    expect(shortcutFromKeyEvent(press("MetaLeft", { metaKey: true }))).toBeNull();
    expect(shortcutFromKeyEvent(press("ArrowUp", { metaKey: true }))).toBeNull();
  });
});

describe("shortcutKeys", () => {
  it("splits symbols into keycaps", () => {
    expect(shortcutKeys("⌃⌥⌘T")).toEqual(["⌃", "⌥", "⌘", "T"]);
    expect(shortcutKeys("⌥Space")).toEqual(["⌥", "Space"]);
  });

  it("splits accelerator syntax", () => {
    expect(shortcutKeys("Ctrl+Alt+T")).toEqual(["Ctrl", "Alt", "T"]);
  });
});

describe("platform conventions", () => {
  it("keeps the macOS symbols as keycaps", () => {
    expect(shortcutKeys("⌃⌥⌘T", "macos")).toEqual(["⌃", "⌥", "⌘", "T"]);
    expect(formatShortcut("⌃⌥⌘T", "macos")).toBe("⌃⌥⌘T");
  });

  it("names the keys on Windows and Linux", () => {
    expect(shortcutKeys("⌃⌥⇧K", "windows")).toEqual(["Ctrl", "Alt", "Shift", "K"]);
    expect(formatShortcut("⌃⌥⇧K", "windows")).toBe("Ctrl+Alt+Shift+K");
    expect(formatShortcut("⌃⌥⇧K", "linux")).toBe("Ctrl+Alt+Shift+K");
    expect(formatShortcut("⌥Space", "linux")).toBe("Alt+Space");
  });

  it("calls the Command symbol Win on Windows and Super on Linux", () => {
    expect(formatShortcut("⌃⌥⌘T", "windows")).toBe("Ctrl+Alt+Win+T");
    expect(formatShortcut("⌃⌥⌘T", "linux")).toBe("Ctrl+Alt+Super+T");
  });

  it("passes accelerator syntax through on every OS", () => {
    expect(formatShortcut("Ctrl+Alt+T", "macos")).toBe("Ctrl+Alt+T");
    expect(formatShortcut("Ctrl+Alt+T", "windows")).toBe("Ctrl+Alt+T");
  });

  it("defaults to a combination without the Windows/Super key outside macOS", () => {
    expect(defaultShortcut("macos")).toBe("⌃⌥⌘T");
    expect(defaultShortcut("windows")).toBe("⌃⌥⇧K");
    expect(defaultShortcut("linux")).toBe("⌃⌥⇧K");
    expect(formatShortcut(defaultShortcut("windows"), "windows")).toBe("Ctrl+Alt+Shift+K");
  });
});
