import { useEffect } from "react";

import type { OsDto } from "@/shared/ipc";

import { isReservedShortcut, type SectionId, sectionForShortcut } from "../lib/sections";

/** ⌘1..⌘8 (Ctrl off macOS) switch sections; ⌘K is swallowed for the future command palette. */
export function useSectionShortcuts(onSelect: (section: SectionId) => void, os: OsDto = "macos"): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const section = sectionForShortcut(event, os);
      if (section) {
        event.preventDefault();
        onSelect(section);
      } else if (isReservedShortcut(event, os)) {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSelect, os]);
}
