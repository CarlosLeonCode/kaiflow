import { TriangleAlert } from "lucide-react";

import { useT, type Messages } from "@/shared/i18n";
import type { DegradedReasonDto, OsDto } from "@/shared/ipc";
import { platformWords } from "@/shared/lib/platform";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";

/**
 * What a degraded reason means, shared with the places that depend on window tracking. Without
 * a reason (not expected outside macOS; the backend always sends one) the copy stays generic.
 */
export function degradedCopy(reason: DegradedReasonDto | null, t: Messages): { title: string; description: string } {
  return t.tracking.degraded[reason ?? "unknown"];
}

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
  const t = useT();
  const mac = os === "macos";
  const kind = reason ?? (mac ? "accessibility_denied" : null);
  const copy = degradedCopy(kind, t);
  return (
    <Alert variant="warning">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <AlertTitle>{copy.title}</AlertTitle>
        <AlertDescription>{copy.description}</AlertDescription>
        {mac && kind === "accessibility_denied" && (
          <Button size="sm" variant="secondary" className="mt-1" onClick={onOpenSettings}>
            {t.tracking.openSystemSettings}
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
  const t = useT();
  return (
    <Alert variant="warning">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <AlertTitle>{t.tracking.shortcutUnavailable(shortcut)}</AlertTitle>
        <AlertDescription data-selectable>
          {t.tracking.shortcutFallback(reason, platformWords(os, t).tray)}
        </AlertDescription>
      </div>
    </Alert>
  );
}
