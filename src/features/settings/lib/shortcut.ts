/** Pure helpers for the global shortcut field. The stored form is macOS symbols + key (`⌃⌥⌘T`). */

export const DEFAULT_SHORTCUT = "⌃⌥⌘T";

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
 * Control, Option or Command (Shift alone would hijack typing); otherwise it is `null`.
 */
export function shortcutFromKeyEvent(event: KeyLike): string | null {
  const key = keyName(event.code);
  if (!key) return null;
  if (!event.ctrlKey && !event.altKey && !event.metaKey) return null;
  return `${event.ctrlKey ? "⌃" : ""}${event.altKey ? "⌥" : ""}${event.shiftKey ? "⇧" : ""}${
    event.metaKey ? "⌘" : ""
  }${key}`;
}

/** Splits a stored shortcut into the glyphs to draw as separate keycaps. */
export function shortcutKeys(shortcut: string): string[] {
  if (shortcut.includes("+")) return shortcut.split("+").map((part) => part.trim());
  const modifiers = "⌃⌥⇧⌘";
  const chars = Array.from(shortcut);
  const lead = chars.filter((c) => modifiers.includes(c));
  const rest = chars.filter((c) => !modifiers.includes(c)).join("");
  return rest ? [...lead, rest] : lead;
}
