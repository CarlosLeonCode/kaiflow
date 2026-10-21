import { CircleAlert, X } from "lucide-react";
import { useState } from "react";

import { events, useTauriEvent } from "@/shared/ipc";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";

/**
 * One-time notice when the automatic backup fails. The backend announces only the first
 * failure of a streak, so this never nags; the details stay in Settings > Data.
 */
export function BackupNoticeContainer() {
  const [failure, setFailure] = useState<string | null>(null);
  useTauriEvent(events.backupFinished, (result) => setFailure(result.ok ? null : result.message));
  if (!failure) return null;
  return (
    <Alert variant="warning" role="alert" className="mx-6 mt-3 shrink-0 items-start justify-between">
      <span className="flex min-w-0 gap-2">
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <AlertDescription>
          The automatic backup failed: {failure} See Settings, then Data, to fix it or choose another folder.
        </AlertDescription>
      </span>
      <Button variant="ghost" size="icon" aria-label="Dismiss backup notice" onClick={() => setFailure(null)}>
        <X />
      </Button>
    </Alert>
  );
}
