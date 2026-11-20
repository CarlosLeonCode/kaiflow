import { en, type Messages } from "@/shared/i18n/en";
import type { OsDto, PlatformInfoDto } from "@/shared/ipc";

/**
 * Assumed until `platform_info` answers (one local call at startup), and if it ever fails.
 * macOS is the primary platform, so its copy is the safe default.
 */
export const DEFAULT_PLATFORM: PlatformInfoDto = {
  os: "macos",
  session: null,
  needs_accessibility_permission: true,
};

export function osOf(platform: PlatformInfoDto | undefined): OsDto {
  return platform?.os ?? DEFAULT_PLATFORM.os;
}

/** Linux on Wayland: the active window cannot be observed (idle, lock and sleep still work). */
export function isWayland(platform: PlatformInfoDto | undefined): boolean {
  return platform?.os === "linux" && platform.session === "wayland";
}

/** How each OS names the device and the place where the app icon lives. */
export interface PlatformWords {
  /** "this Mac" or "this computer". */
  device: string;
  /** Sentence start: "This Mac" or "This computer". */
  Device: string;
  /** "menu bar" or "system tray". */
  tray: string;
  /** Sentence start: "Menu bar" or "System tray". */
  Tray: string;
}

/** The words for `os` in the active language (`useT()`); English when not given. */
export function platformWords(os: OsDto, t: Messages = en): PlatformWords {
  return os === "macos" ? t.platform.words.macos : t.platform.words.other;
}
