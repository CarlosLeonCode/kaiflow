import { useT } from "@/shared/i18n";
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
  const m = useT().focus.drift;
  return (
    <div
      role="status"
      aria-label={m.label}
      className="mt-3 rounded-2xl border border-warning-foreground/20 bg-warning px-3 py-2.5 text-warning-foreground"
    >
      <p className="font-medium">{m.title}</p>
      <p className="mt-0.5 text-xs">
        {m.body(app.app_name, intent)}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => onAllowApp(app.app_id)}>
          {m.allowApp}
        </Button>
        <Button size="sm" variant="primary" disabled={busy} onClick={onBackToIt}>
          {m.backToIt}
        </Button>
        <Button size="sm" disabled={busy} onClick={onEnd}>
          {m.endSession}
        </Button>
      </div>
    </div>
  );
}
