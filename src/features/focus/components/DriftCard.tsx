import type { FocusAppDto } from "@/shared/ipc";
import { Button } from "@/shared/ui/button";

interface Props {
  app: FocusAppDto;
  intent: string;
  busy?: boolean;
  onAllowApp: (appId: string) => void;
  onBackToIt: () => void;
  onEnd: () => void;
}

/**
 * The gentle drift alert: you have been somewhere else for a while. Three ways out, none of
 * them a reprimand: this app belongs here after all, I am going back, or I am done.
 */
export function DriftCard({ app, intent, busy = false, onAllowApp, onBackToIt, onEnd }: Props) {
  return (
    <div
      role="status"
      aria-label="Drift alert"
      className="mt-3 rounded-md border border-warning-foreground/20 bg-warning px-3 py-2.5 text-warning-foreground"
    >
      <p className="font-medium">Still on track?</p>
      <p className="mt-0.5 text-xs">
        You have been in {app.app_name} for a while. Does it belong to “{intent}”?
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => onAllowApp(app.app_id)}>
          Allow this app
        </Button>
        <Button size="sm" variant="primary" disabled={busy} onClick={onBackToIt}>
          Back to it
        </Button>
        <Button size="sm" disabled={busy} onClick={onEnd}>
          End session
        </Button>
      </div>
    </div>
  );
}
