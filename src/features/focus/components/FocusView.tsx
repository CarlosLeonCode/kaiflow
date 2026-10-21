import { CircleAlert, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import type { DegradedReasonDto, FocusSessionDto } from "@/shared/ipc";
import { formatDuration, formatTimeOfDay } from "@/shared/lib/time";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Page, type IntroSlot } from "@/shared/ui/page";
import { Skeleton } from "@/shared/ui/skeleton";
import { DEGRADED_COPY } from "@/features/tracking/components/StatusBanners";

import { alertsText, endReasonLabel, kindLabel, plannedText } from "../lib/focus";

interface Props {
  intro?: IntroSlot;
  loading: boolean;
  error: string | null;
  /** Why drift nudges cannot work (tracking is degraded); `null` when they can. */
  unavailable: DegradedReasonDto | null;
  /** Work blocks completed today and the time spent in today's blocks. */
  today: { blocks: number; focusMs: number };
  /** The running block, the end card, or the start view. */
  main: ReactNode;
  /** The finished focus block waiting to be dismissed. */
  summary: ReactNode;
  history: readonly FocusSessionDto[];
}

function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3">
      <dt className="text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</dt>
      <dd className="tabular mt-1 text-xl font-semibold">{value}</dd>
    </div>
  );
}

/** Focus section (presentational): today's numbers, the timer (or how to start one), history. */
export function FocusView({ intro, loading, error, unavailable, today, main, summary, history }: Props) {
  const copy = unavailable ? DEGRADED_COPY[unavailable] : null;
  return (
    <Page title="Focus" subtitle="Timers, pomodoro cycles and gentle focus" intro={intro}>
      {error ? (
        <Alert variant="warning" role="alert">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <AlertDescription>Could not load focus sessions: {error}</AlertDescription>
        </Alert>
      ) : loading ? (
        <div className="space-y-4" aria-label="Loading focus sessions">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <div className="mx-auto max-w-2xl space-y-4">
          {copy && (
            <Alert variant="warning">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1 space-y-1">
                <AlertTitle>Drift nudges are unavailable</AlertTitle>
                <AlertDescription>
                  Focus blocks need to see which app is in front to notice a drift, and tracking cannot do that right
                  now. Plain timers still work. {copy.title}. {copy.description}
                </AlertDescription>
              </div>
            </Alert>
          )}
          <dl aria-label="Today" className="grid grid-cols-2 gap-3">
            <Stat label="Blocks done today" value={`${today.blocks}`} />
            <Stat label="Focus time today" value={today.focusMs > 0 ? formatDuration(today.focusMs) : "0m"} />
          </dl>
          {main}
          {summary}
          {history.length > 0 && (
            <section aria-label="Recent sessions" className="rounded-xl border border-border bg-background p-4">
              <h2 className="mb-2 text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Recent sessions</h2>
              <ul className="divide-y divide-border">
                {history.map((session) => (
                  <li key={session.id} className="flex items-baseline justify-between gap-4 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium" title={session.intent || undefined}>
                        {session.intent || kindLabel(session.kind)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {kindLabel(session.kind)} · {dayLabel(session.started_at)}, {formatTimeOfDay(session.started_at)} ·{" "}
                        {plannedText(session)} · {endReasonLabel(session.end_reason)}
                        {session.kind === "focus" && ` · ${alertsText(session.drift_alerts)}`}
                      </p>
                    </div>
                    {session.kind === "focus" ? (
                      <p className="tabular shrink-0 text-sm font-medium" aria-label="On target">
                        {session.percent_inside === null ? "No data" : `${session.percent_inside}%`}
                      </p>
                    ) : (
                      <p className="tabular shrink-0 text-sm text-muted-foreground" aria-label="Time spent">
                        {formatDuration(session.worked_ms)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Page>
  );
}
