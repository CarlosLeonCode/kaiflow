import type { OsDto } from "@/shared/ipc";

/** Sidebar groups, in order: daily work first, looking back next, setup last. Labels live in `shell.groups`. */
export const SECTION_GROUPS = ["daily", "look-back", "setup"] as const;

export type SectionGroupId = (typeof SECTION_GROUPS)[number];

/**
 * Dashboard sections in sidebar order; the digit is the ⌘ (Ctrl off macOS) shortcut. Labels
 * live in `shell.sections` of the UI messages.
 */
export const SECTIONS = [
  { id: "today", digit: "1", group: "daily" },
  { id: "focus", digit: "2", group: "daily" },
  { id: "goals", digit: "3", group: "daily" },
  { id: "insights", digit: "4", group: "look-back" },
  { id: "activities", digit: "5", group: "setup" },
  { id: "privacy", digit: "6", group: "setup" },
  { id: "settings", digit: "7", group: "setup" },
] as const satisfies readonly { id: string; digit: string; group: SectionGroupId }[];

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

/** ⌘1 to ⌘7 (Ctrl+1 to Ctrl+7 off macOS) select a section; any other key is not ours. */
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
