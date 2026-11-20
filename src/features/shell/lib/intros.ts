import type { Messages } from "@/shared/i18n";
import type { OsDto } from "@/shared/ipc";
import type { IntroContent } from "@/shared/ui/SectionIntro";

import type { SectionId } from "./sections";

/**
 * The intro of `section` in the active language (`shell.intros`), worded for the OS: the app
 * icon lives in the menu bar on macOS and in the system tray elsewhere. Dismissals persist by
 * section id, so they survive a language change.
 */
export function introFor(section: SectionId, os: OsDto, t: Messages): IntroContent {
  const { today, ...others } = t.shell.intros;
  if (section !== "today") return others[section];
  return { ...today, can: today.can(os === "macos" ? t.platform.tray.macos : t.platform.tray.other) };
}
