import type { OsDto } from "@/shared/ipc";

/** Dashboard sections in sidebar order; the digit is the ⌘ (Ctrl off macOS) shortcut. */
export const SECTIONS = [
  { id: "today", label: "Today", digit: "1" },
  { id: "overview", label: "Overview", digit: "2" },
  { id: "goals", label: "Goals", digit: "3" },
  { id: "focus", label: "Focus", digit: "4" },
  { id: "review", label: "Review", digit: "5" },
  { id: "activities", label: "Activities", digit: "6" },
  { id: "privacy", label: "Privacy", digit: "7" },
  { id: "settings", label: "Settings", digit: "8" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

export const DEFAULT_SECTION: SectionId = "today";

export interface ShortcutEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Command on macOS, Ctrl on Windows and Linux (where the Windows/Super key belongs to the shell). */
function plainCommand(event: ShortcutEvent, os: OsDto): boolean {
  const mac = os === "macos";
  const primary = mac ? event.metaKey : event.ctrlKey;
  const other = mac ? event.ctrlKey : event.metaKey;
  return primary && !other && !event.altKey && !event.shiftKey;
}

/** ⌘1 to ⌘8 (Ctrl+1 to Ctrl+8 off macOS) select a section; any other key is not ours. */
export function sectionForShortcut(event: ShortcutEvent, os: OsDto = "macos"): SectionId | null {
  if (!plainCommand(event, os)) return null;
  return SECTIONS.find((section) => section.digit === event.key)?.id ?? null;
}

/** ⌘K (Ctrl+K) is reserved for the command palette (a later feature): claimed, does nothing yet. */
export function isReservedShortcut(event: ShortcutEvent, os: OsDto = "macos"): boolean {
  return plainCommand(event, os) && event.key.toLowerCase() === "k";
}

/** Keycap text for a section digit: `⌘1` on macOS, `Ctrl+1` elsewhere. */
export function sectionShortcutLabel(digit: string, os: OsDto = "macos"): string {
  return os === "macos" ? `⌘${digit}` : `Ctrl+${digit}`;
}

/** `aria-keyshortcuts` value for a section digit. */
export function sectionAriaShortcut(digit: string, os: OsDto = "macos"): string {
  return os === "macos" ? `Meta+${digit}` : `Control+${digit}`;
}
