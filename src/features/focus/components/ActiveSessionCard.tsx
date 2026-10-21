import { Timer } from "lucide-react";

import type { FocusActiveDto } from "@/shared/ipc";
import { Button } from "@/shared/ui/button";

import { EXTEND_MINUTES, allowedSummary, countdownText, elapsedPercent, remainingLabel, remainingMs } from "../lib/focus";
import { DriftCard } from "./DriftCard";

interface Props {
  session: FocusActiveDto;
  now: number;
  /** The popover variant: no allowed summary and no extend button. */
  compact?: boolean;
  busy?: boolean;
  error?: string | null;
  onEnd: () => void;
  onExtend?: (minutes: number) => void;
  onAllowApp: (appId: string) => void;
  onBackToIt: () => void;
}

/** The running session: intent, countdown, progress and, when it applies, the drift card. */
export function ActiveSessionCard({ session, now, compact = false, busy = false, error, onEnd, onExtend, onAllowApp, onBackToIt }: Props) {
  const left = remainingMs(session, now);
  const percent = elapsedPercent(session, now);
  return (
    <section aria-label="Focus session" className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            <Timer className="size-3.5" aria-hidden="true" />
            Focus
          </h2>
          <p className="mt-1 truncate font-medium" title={session.intent}>
            {session.intent}
          </p>
        </div>
        <p
          data-testid="focus-countdown"
          className="tabular shrink-0 text-2xl font-semibold tracking-tight"
          aria-label={remainingLabel(left)}
        >
          {countdownText(left)}
        </p>
      </div>
      <div
        role="img"
        aria-label={`${percent}% of the session has passed`}
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      {!compact && (
        <p className="mt-2 text-xs text-muted-foreground">
          Allowed: {allowedSummary(session.allowed)}
          {session.drift_alerts > 0 && ` · ${session.drift_alerts === 1 ? "1 alert" : `${session.drift_alerts} alerts`} so far`}
        </p>
      )}
      {session.current === null && (
        <p className="mt-2 text-xs text-muted-foreground">
          Nothing is being tracked right now, so drift alerts are paused. The countdown keeps going.
        </p>
      )}
      {session.alerting ? (
        <DriftCard
          app={session.alerting}
          intent={session.intent}
          busy={busy}
          onAllowApp={onAllowApp}
          onBackToIt={onBackToIt}
          onEnd={onEnd}
        />
      ) : (
        <div className="mt-3 flex justify-end gap-2">
          {!compact && onExtend && (
            <Button size="sm" disabled={busy} onClick={() => onExtend(EXTEND_MINUTES)}>
              +{EXTEND_MINUTES} min
            </Button>
          )}
          <Button size="sm" disabled={busy} onClick={onEnd}>
            End session
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
