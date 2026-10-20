import { TriangleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";

/** Accessibility is off: only app names are recorded (R5.3). */
export function DegradedBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <Alert variant="warning">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <AlertTitle>Window titles are off</AlertTitle>
        <AlertDescription>
          Accessibility access is not granted, so only app names are recorded.
        </AlertDescription>
        <Button size="sm" variant="secondary" className="mt-1" onClick={onOpenSettings}>
          Open System Settings
        </Button>
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
