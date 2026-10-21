import { CircleAlert, Timer, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import type { DegradedReasonDto, FocusSessionDto } from "@/shared/ipc";
import { formatTimeOfDay } from "@/shared/lib/time";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Page, type IntroSlot } from "@/shared/ui/page";
import { Skeleton } from "@/shared/ui/skeleton";
import { DEGRADED_COPY } from "@/features/tracking/components/StatusBanners";

import { alertsText, endReasonLabel, plannedText } from "../lib/focus";

interface Props {
  intro?: IntroSlot;
  loading: boolean;
  error: string | null;
  /** Why a session cannot start (tracking is degraded); `null` when it can. */
  unavailable: DegradedReasonDto | null;
  /** The running session card, when one runs. */
  activeCard: ReactNode;
  /** The finished session waiting to be dismissed. */
  summary: ReactNode;
  history: readonly FocusSessionDto[];
  running: boolean;
  /** The start dialog. */
  dialog: ReactNode;
  onStart: () => void;
}

function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** Focus section (presentational): start, the running session, the last summary and history. */
export function FocusView({ intro, loading, error, unavailable, activeCard, summary, history, running, dialog, onStart }: Props) {
  const copy = unavailable ? DEGRADED_COPY[unavailable] : null;
  const empty = !loading && !error && !running && history.length === 0 && summary === null;
  return (
    <Page
      title="Focus"
      subtitle="Work in timed blocks"
      intro={intro}
      actions={
        <Button size="sm" variant="primary" disabled={running || unavailable !== null} onClick={onStart}>
          <Timer aria-hidden="true" />
          Start session
        </Button>
      }
    >
      {error ? (
        <Alert variant="warning" role="alert">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <AlertDescription>Could not load focus sessions: {error}</AlertDescription>
        </Alert>
      ) : loading ? (
        <div className="space-y-4" aria-label="Loading focus sessions">
          <Skeleton className="h-32" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <div className="space-y-4">
          {copy && (
            <Alert variant="warning">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1 space-y-1">
                <AlertTitle>Focus sessions are unavailable</AlertTitle>
                <AlertDescription>
                  A session needs to see which app is in front to notice a drift, and tracking cannot do that right
                  now. {copy.title}. {copy.description}
                </AlertDescription>
              </div>
            </Alert>
          )}
          {activeCard}
          {summary}
          {empty ? (
            <EmptyState
              title="No focus sessions yet"
              action={unavailable ? undefined : { label: "Start a session", onClick: onStart }}
            >
              Pick what you want to get done and for how long. You will see how much of the time stayed on target.
            </EmptyState>
          ) : (
            history.length > 0 && (
              <section aria-label="Recent sessions" className="rounded-lg border border-border bg-background p-4">
                <h2 className="mb-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                  Recent sessions
                </h2>
                <ul className="divide-y divide-border">
                  {history.map((session) => (
                    <li key={session.id} className="flex items-baseline justify-between gap-4 py-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium" title={session.intent}>
                          {session.intent}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {dayLabel(session.started_at)}, {formatTimeOfDay(session.started_at)} ·{" "}
                          {plannedText(session)} · {endReasonLabel(session.end_reason)} · {alertsText(session.drift_alerts)}
                        </p>
                      </div>
                      <p className="tabular shrink-0 text-sm font-medium" aria-label="On target">
                        {session.percent_inside === null ? "No data" : `${session.percent_inside}%`}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            )
          )}
        </div>
      )}
      {dialog}
    </Page>
  );
}
