import { describe, expect, it } from "vitest";

import { shortcutFromKeyEvent, shortcutKeys, type KeyLike } from "./shortcut";

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
