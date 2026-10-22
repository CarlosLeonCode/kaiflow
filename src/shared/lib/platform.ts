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

const MAC_WORDS: PlatformWords = { device: "this Mac", Device: "This Mac", tray: "menu bar", Tray: "Menu bar" };
const PC_WORDS: PlatformWords = {
  device: "this computer",
  Device: "This computer",
  tray: "system tray",
  Tray: "System tray",
};

export function platformWords(os: OsDto): PlatformWords {
  return os === "macos" ? MAC_WORDS : PC_WORDS;
}
