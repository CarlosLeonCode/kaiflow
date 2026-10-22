import { TriangleAlert } from "lucide-react";

import type { DegradedReasonDto, OsDto } from "@/shared/ipc";
import { platformWords } from "@/shared/lib/platform";
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
      "Idle detection still works, and so do lock, sleep and focus timers. Log in to an X11 (Xorg) " +
      "session, such as \"Ubuntu on Xorg\", to track apps and window titles.",
  },
  no_display: {
    title: "No display found",
    description: "No display server could be reached, so no windows can be tracked.",
  },
};

/** A degraded state without a reason outside macOS (not expected; the backend always sends one). */
const UNKNOWN_DEGRADED = {
  title: "Window tracking is limited",
  description: "The app in front cannot be observed right now, so only idle time is recorded.",
};

/**
 * Tracking is degraded (R5.3). On macOS Accessibility is off and only app names are
 * recorded; there the banner links to System Settings. On Linux the session itself is the
 * cause (Wayland, no display), so it only explains what is and is not recorded. System
 * Settings is never offered outside macOS.
 */
export function DegradedBanner({
  reason,
  os = "macos",
  onOpenSettings,
}: {
  reason?: DegradedReasonDto | null;
  os?: OsDto;
  onOpenSettings: () => void;
}) {
  const mac = os === "macos";
  const kind = reason ?? (mac ? "accessibility_denied" : null);
  const copy = kind ? DEGRADED_COPY[kind] : UNKNOWN_DEGRADED;
  return (
    <Alert variant="warning">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <AlertTitle>{copy.title}</AlertTitle>
        <AlertDescription>{copy.description}</AlertDescription>
        {mac && kind === "accessibility_denied" && (
          <Button size="sm" variant="secondary" className="mt-1" onClick={onOpenSettings}>
            Open System Settings
          </Button>
        )}
      </div>
    </Alert>
  );
}

/**
 * The global shortcut could not be registered; tracking itself is unaffected (R6.3).
 * `shortcut` arrives already formatted for the platform.
 */
export function ShortcutBanner({ shortcut, reason, os = "macos" }: { shortcut: string; reason: string; os?: OsDto }) {
  return (
    <Alert variant="warning">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <AlertTitle>Shortcut {shortcut} is unavailable</AlertTitle>
        <AlertDescription data-selectable>
          {reason}. You can still pause and resume here or from the {platformWords(os).tray}.
        </AlertDescription>
      </div>
    </Alert>
  );
}
