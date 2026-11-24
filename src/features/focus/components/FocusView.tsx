import { CircleAlert, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { useLocale, useT } from "@/shared/i18n";
import type { DegradedReasonDto, FocusSessionDto } from "@/shared/ipc";
import { formatDuration, formatTimeOfDay } from "@/shared/lib/time";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { CARD_HEADING } from "@/shared/ui/card";
import { Page, type IntroSlot } from "@/shared/ui/page";
import { Skeleton } from "@/shared/ui/skeleton";
import { degradedCopy } from "@/features/tracking/components/StatusBanners";

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

function dayLabel(ms: number, locale: string): string {
  return new Date(ms).toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-border bg-background px-5 py-4">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="tabular mt-0.5 font-display text-2xl leading-[1.1] font-extrabold tracking-[-0.02em]">{value}</dd>
    </div>
  );
}

/** Focus section (presentational): today's numbers, the timer (or how to start one), history. */
export function FocusView({ intro, loading, error, unavailable, today, main, summary, history }: Props) {
  const t = useT();
  const locale = useLocale();
  const copy = unavailable ? degradedCopy(unavailable, t) : null;
  return (
    <Page title={t.shell.sections.focus} subtitle={t.focus.subtitle} intro={intro}>
      {error ? (
        <Alert variant="warning" role="alert">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <AlertDescription>{t.focus.loadError(error)}</AlertDescription>
        </Alert>
      ) : loading ? (
        <div className="space-y-4" aria-label={t.focus.loading}>
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <div className="mx-auto max-w-2xl space-y-4">
          {copy && (
            <Alert variant="warning">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1 space-y-1">
                <AlertTitle>{t.focus.unavailable.title}</AlertTitle>
                <AlertDescription>
                  {t.focus.unavailable.body(copy.title, copy.description)}
                </AlertDescription>
              </div>
            </Alert>
          )}
          <dl aria-label={t.shell.sections.today} className="grid grid-cols-2 gap-3">
            <Stat label={t.focus.blocksToday} value={`${today.blocks}`} />
            <Stat label={t.focus.focusToday} value={today.focusMs > 0 ? formatDuration(today.focusMs) : "0m"} />
          </dl>
          {main}
          {summary}
          {history.length > 0 && (
            <section aria-label={t.focus.recent} className="rounded-card border border-border bg-background p-5">
              <h2 className={`mb-2 ${CARD_HEADING}`}>{t.focus.recent}</h2>
              <ul className="divide-y divide-border">
                {history.map((session) => (
                  <li key={session.id} className="flex items-baseline justify-between gap-4 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium" title={session.intent || undefined}>
                        {session.intent || kindLabel(session.kind, t)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {kindLabel(session.kind, t)} · {dayLabel(session.started_at, locale)},{" "}
                        {formatTimeOfDay(session.started_at, locale)} · {plannedText(session)} ·{" "}
                        {endReasonLabel(session.end_reason, t)}
                        {session.kind === "focus" && ` · ${alertsText(session.drift_alerts, t)}`}
                      </p>
                    </div>
                    {session.kind === "focus" ? (
                      <p className="tabular shrink-0 text-sm font-medium" aria-label={t.focus.onTarget}>
                        {session.percent_inside === null ? t.focus.noData : `${session.percent_inside}%`}
                      </p>
                    ) : (
                      <p className="tabular shrink-0 text-sm text-muted-foreground" aria-label={t.focus.timeSpent}>
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
