/** Dashboard sections in sidebar order; the digit is the ⌘ shortcut. */
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

function plainCommand(event: ShortcutEvent): boolean {
  return event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
}

/** ⌘1 to ⌘8 select a section; any other key (or extra modifier) is not ours. */
export function sectionForShortcut(event: ShortcutEvent): SectionId | null {
  if (!plainCommand(event)) return null;
  return SECTIONS.find((section) => section.digit === event.key)?.id ?? null;
}

/** ⌘K is reserved for the command palette (a later feature): claimed, does nothing yet. */
export function isReservedShortcut(event: ShortcutEvent): boolean {
  return plainCommand(event) && event.key.toLowerCase() === "k";
}
