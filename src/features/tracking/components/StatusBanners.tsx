import { TriangleAlert } from "lucide-react";

import type { DegradedReasonDto } from "@/shared/ipc";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";

/** What each degraded reason means, shared with the places that depend on window tracking. */
export const DEGRADED_COPY: Record<DegradedReasonDto, { title: string; description: string }> = {
  accessibility_denied: {
    title: "Window titles are off",
    description: "Accessibility access is not granted, so only app names are recorded.",
  },
  wayland_session: {
    title: "Window tracking is unavailable on Wayland",
    description:
      "Wayland does not let apps see which window is in front, so time per app is not recorded. " +
      "Idle detection still works. Log in to an X11 (Xorg) session to track apps and window titles.",
  },
  no_display: {
    title: "No display found",
    description: "No display server could be reached, so no windows can be tracked.",
  },
};

/**
 * Tracking is degraded (R5.3). On macOS Accessibility is off and only app names are
 * recorded; there the banner links to System Settings. On Linux the session itself is the
 * cause (Wayland, no display), so it only explains what is and is not recorded.
 */
export function DegradedBanner({
  reason,
  onOpenSettings,
}: {
  reason?: DegradedReasonDto | null;
  onOpenSettings: () => void;
}) {
  const kind = reason ?? "accessibility_denied";
  const copy = DEGRADED_COPY[kind];
  return (
    <Alert variant="warning">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <AlertTitle>{copy.title}</AlertTitle>
        <AlertDescription>{copy.description}</AlertDescription>
        {kind === "accessibility_denied" && (
          <Button size="sm" variant="secondary" className="mt-1" onClick={onOpenSettings}>
            Open System Settings
          </Button>
        )}
      </div>
    </Alert>
  );
}

/** The global shortcut could not be registered; tracking itself is unaffected (R6.3). */
export function ShortcutBanner({ shortcut, reason }: { shortcut: string; reason: string }) {
  return (
    <Alert variant="warning">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <AlertTitle>Shortcut {shortcut} is unavailable</AlertTitle>
        <AlertDescription data-selectable>
          {reason}. You can still pause and resume here or from the menu bar.
        </AlertDescription>
      </div>
    </Alert>
  );
}
