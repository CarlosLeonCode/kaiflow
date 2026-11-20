import type { Messages } from "@/shared/i18n";
import type { PermissionStateDto, PlatformInfoDto } from "@/shared/ipc";
import { DEFAULT_PLATFORM, isWayland } from "@/shared/lib/platform";

export const STEPS = ["welcome", "access", "ready"] as const;
export type Step = (typeof STEPS)[number];

/**
 * Step names. The middle step is about the Accessibility permission only on macOS; Windows
 * and Linux need no permission, so there it is just the choice of what to record.
 */
export function stepLabels(t: Messages, platform: PlatformInfoDto = DEFAULT_PLATFORM): Record<Step, string> {
  const m = t.onboarding.steps;
  return {
    welcome: m.welcome,
    access: platform.needs_accessibility_permission ? m.permissions : m.recording,
    ready: m.ready,
  };
}

export function nextStep(step: Step): Step {
  return STEPS[Math.min(STEPS.indexOf(step) + 1, STEPS.length - 1)] ?? step;
}

export function previousStep(step: Step): Step {
  return STEPS[Math.max(STEPS.indexOf(step) - 1, 0)] ?? step;
}

/**
 * macOS sometimes keeps answering "not trusted" to a process that was already running when
 * the grant happened, so titles stay empty until the app restarts (R5.4). Whenever access
 * flips from missing to granted during this session, a restart is offered (never forced).
 * Only where a permission exists at all: elsewhere nothing is ever granted.
 */
export function shouldOfferRestart(
  sawDenied: boolean,
  current: PermissionStateDto | undefined,
  platform: PlatformInfoDto = DEFAULT_PLATFORM,
): boolean {
  return platform.needs_accessibility_permission && sawDenied && current === "granted";
}

export interface Summary {
  titles: string;
  /** Label of the second row. */
  accessLabel: string;
  access: string;
}

/** One-line recap for the last step. */
export function buildSummary(
  t: Messages,
  storeTitles: boolean,
  permission: PermissionStateDto | undefined,
  platform: PlatformInfoDto = DEFAULT_PLATFORM,
): Summary {
  const m = t.onboarding.summary;
  if (isWayland(platform)) {
    return {
      titles: storeTitles ? m.waylandTitlesOn : m.waylandTitlesOff,
      accessLabel: m.windowTracking,
      access: m.unavailableWayland,
    };
  }
  const titles = storeTitles ? m.titlesOn : m.titlesOff;
  if (!platform.needs_accessibility_permission) {
    return { titles, accessLabel: m.permission, access: m.noneNeeded };
  }
  const granted = permission === "granted";
  return {
    titles,
    accessLabel: m.permission,
    access: granted ? m.accessOn : storeTitles ? m.accessOffTitles : m.accessNotNeeded,
  };
}
