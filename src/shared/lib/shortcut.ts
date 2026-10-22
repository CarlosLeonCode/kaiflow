import type { OsDto } from "@/shared/ipc";

/**
 * Pure helpers for the global shortcut. The stored form is modifier symbols + key (`⌃⌥⌘T`)
 * on every OS; the backend turns it into an accelerator and the UI shows it with each
 * platform's conventions (`⌃⌥⌘T` keycaps on macOS, `Ctrl+Alt+Shift+K` elsewhere).
 */

/** Control-Option-Command-T. Mirrors `MACOS_DEFAULT_SHORTCUT` in the application crate. */
export const MACOS_DEFAULT_SHORTCUT = "⌃⌥⌘T";

/**
 * Ctrl+Alt+Shift+K on Windows and Linux (mirrors `PC_DEFAULT_SHORTCUT`): their shells reserve
 * the Windows/Super key, Ctrl+Alt+T opens the Ubuntu terminal and Ctrl+Alt+Shift+T is taken by
 * JetBrains IDEs.
 */
export const PC_DEFAULT_SHORTCUT = "⌃⌥⇧K";

export function defaultShortcut(os: OsDto): string {
  return os === "macos" ? MACOS_DEFAULT_SHORTCUT : PC_DEFAULT_SHORTCUT;
}

export interface KeyLike {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** The key part the backend can register; `null` for modifiers, arrows and everything else. */
function keyName(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter?.[1]) return letter[1];
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit?.[1]) return digit[1];
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  if (code === "Space") return "Space";
  return null;
}

/**
 * Converts a key press into the stored shortcut. A global shortcut needs at least one of
 * Control, Option/Alt or Command/Windows/Super (Shift alone would hijack typing); otherwise
 * it is `null`.
 */
export function shortcutFromKeyEvent(event: KeyLike): string | null {
  const key = keyName(event.code);
  if (!key) return null;
  if (!event.ctrlKey && !event.altKey && !event.metaKey) return null;
  return `${event.ctrlKey ? "⌃" : ""}${event.altKey ? "⌥" : ""}${event.shiftKey ? "⇧" : ""}${
    event.metaKey ? "⌘" : ""
  }${key}`;
}

const MODIFIERS = "⌃⌥⇧⌘";

/** Names of the modifier symbols outside macOS; the Command symbol is the Windows/Super key. */
function pcModifier(symbol: string, os: OsDto): string {
  switch (symbol) {
    case "⌃":
      return "Ctrl";
    case "⌥":
      return "Alt";
    case "⇧":
      return "Shift";
    default:
      return os === "windows" ? "Win" : "Super";
  }
}

/**
 * Splits a stored shortcut into the labels to draw as separate keycaps: the symbols on
 * macOS, the key names (`Ctrl`, `Alt`, `Shift`, `Win`/`Super`) elsewhere.
 */
export function shortcutKeys(shortcut: string, os: OsDto = "macos"): string[] {
  if (shortcut.includes("+")) return shortcut.split("+").map((part) => part.trim());
  const chars = Array.from(shortcut.trim());
  const lead = chars.filter((c) => MODIFIERS.includes(c));
  const rest = chars.filter((c) => !MODIFIERS.includes(c)).join("");
  const modifiers = os === "macos" ? lead : lead.map((symbol) => pcModifier(symbol, os));
  return rest ? [...modifiers, rest] : modifiers;
}

/** One-line form: `⌃⌥⌘T` on macOS, `Ctrl+Alt+Shift+K` on Windows and Linux. */
export function formatShortcut(shortcut: string, os: OsDto = "macos"): string {
  if (os === "macos" && !shortcut.includes("+")) return shortcut.trim();
  return shortcutKeys(shortcut, os).join("+");
}
