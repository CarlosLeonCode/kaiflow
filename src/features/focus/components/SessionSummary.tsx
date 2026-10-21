import type { FocusSessionDto } from "@/shared/ipc";
import { formatDuration } from "@/shared/lib/time";
import { Button } from "@/shared/ui/button";

import { alertsText, endReasonLabel, summaryHeadline } from "../lib/focus";

interface Props {
  session: FocusSessionDto;
  /** `null` while it is only being looked at (history); a callback for the one to dismiss. */
  onDismiss?: () => void;
  busy?: boolean;
}

/** How a finished session went: time on and off target, alerts and the biggest distractions. */
export function SessionSummary({ session, onDismiss, busy = false }: Props) {
  const tracked = session.inside_ms + session.outside_ms;
  return (
    <section aria-label="Session summary" className="rounded-lg border border-border bg-background p-4">
      <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {endReasonLabel(session.end_reason)}
      </p>
      <h2 className="mt-1 truncate text-lg font-semibold" title={session.intent}>
        {session.intent}
      </h2>
      <p data-testid="summary-headline" className="mt-2 text-sm">
        {summaryHeadline(session)}
      </p>
      {tracked > 0 && (
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-xs">
          <div>
            <dt className="text-muted-foreground">On target</dt>
            <dd className="tabular font-medium">{formatDuration(session.inside_ms)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Elsewhere</dt>
            <dd className="tabular font-medium">{formatDuration(session.outside_ms)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Drift alerts</dt>
            <dd className="font-medium">{alertsText(session.drift_alerts)}</dd>
          </div>
        </dl>
      )}
      {tracked === 0 && <p className="mt-1 text-xs text-muted-foreground">{alertsText(session.drift_alerts)}</p>}
      {session.top_distractions.length > 0 && (
        <div className="mt-3">
          <h3 className="text-xs font-medium text-muted-foreground">Where the time went instead</h3>
          <ul aria-label="Top distractions" className="mt-1 space-y-0.5 text-sm">
            {session.top_distractions.map((d) => (
              <li key={d.app_id} className="flex justify-between gap-3">
                <span className="truncate">{d.app_name}</span>
                <span className="tabular shrink-0 text-muted-foreground">{formatDuration(d.ms)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {onDismiss && (
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="primary" disabled={busy} onClick={onDismiss}>
            Done
          </Button>
        </div>
      )}
    </section>
  );
}
