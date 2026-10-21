import { useEffect } from "react";

import { isReservedShortcut, type SectionId, sectionForShortcut } from "../lib/sections";

/** ⌘1..⌘6 switch sections; ⌘K is swallowed for the future command palette. */
export function useSectionShortcuts(onSelect: (section: SectionId) => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const section = sectionForShortcut(event);
      if (section) {
        event.preventDefault();
        onSelect(section);
      } else if (isReservedShortcut(event)) {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSelect]);
}
