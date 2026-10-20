import type { PermissionStateDto } from "@/shared/ipc";

export const STEPS = ["welcome", "access", "ready"] as const;
export type Step = (typeof STEPS)[number];

export const STEP_LABELS: Record<Step, string> = {
  welcome: "Welcome",
  access: "Permissions",
  ready: "Ready",
};

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
 */
export function shouldOfferRestart(sawDenied: boolean, current: PermissionStateDto | undefined): boolean {
  return sawDenied && current === "granted";
}

export interface Summary {
  titles: string;
  access: string;
}

/** One-line recap for the last step. */
export function buildSummary(storeTitles: boolean, permission: PermissionStateDto | undefined): Summary {
  const granted = permission === "granted";
  return {
    titles: storeTitles ? "App names and window titles" : "App names only",
    access: granted
      ? "Accessibility is on"
      : storeTitles
        ? "Accessibility is off, so titles will be skipped until you allow it"
        : "Accessibility is not needed",
  };
}
