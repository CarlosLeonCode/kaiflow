import { Download } from "lucide-react";

import type { UpdateInfoDto } from "@/shared/ipc";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";

interface Props {
  update: UpdateInfoDto;
  installing: boolean;
  /** Message of the last failed install attempt. */
  error: string | null;
  onInstall: () => void;
}

/** Popover notice: a newer signed release is ready; installing relaunches the app. */
export function UpdateBanner({ update, installing, error, onInstall }: Props) {
  return (
    <Alert variant="neutral">
      <Download className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <AlertTitle>Version {update.version} is available</AlertTitle>
        <AlertDescription>
          {installing
            ? "Installing. The app will restart in a moment."
            : "Installing restarts the app; your tracking resumes on its own."}
        </AlertDescription>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <Button size="sm" variant="secondary" className="mt-1" disabled={installing} onClick={onInstall}>
          {installing ? "Installing..." : error ? "Try again" : "Install and restart"}
        </Button>
      </div>
    </Alert>
  );
}
