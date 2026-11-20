import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";

import { useLocale, useT } from "@/shared/i18n";
import type { RangeDto, TimelineItemDto, TrackingStateDto } from "@/shared/ipc";
import { formatClock, formatDuration } from "@/shared/lib/time";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Page, type IntroSlot } from "@/shared/ui/page";
import { Skeleton } from "@/shared/ui/skeleton";

import { stateLabel } from "@/features/tracking/lib/derive";

import { layoutTimeline, timelineWindow, type AppRow, type ActivityRow } from "../lib/today";
import { AppList } from "./AppList";
import { ActivityList } from "./ActivityList";
import { DayTimeline } from "./DayTimeline";

interface Props {
  /** Section intro and its header help button, rendered by `Page`. */
  intro?: IntroSlot;
  /** The running focus session (or the summary of the last one), above everything else. */
  focus?: ReactNode;
  /** The goals strip, shown above the cards. */
  goals?: ReactNode;
  /** Whether any goal exists: with none, the empty day does not repeat an invitation. */
  hasGoals?: boolean;
  /** Next step when nothing is tracked and tracking is not running (start or resume). */
  emptyAction?: { label: string; onClick: () => void };
  /** Next step when tracking runs but nothing is recorded yet: set up activities meanwhile. */
  onOpenActivities?: () => void;
  range: RangeDto;
  now: number;
  state: TrackingStateDto | undefined;
  dark: boolean;
  loading: boolean;
  error: string | null;
  items: readonly TimelineItemDto[];
  apps: readonly AppRow[];
  activities: readonly ActivityRow[];
  /** Active time (live): time at the computer, excludes idle and discarded time (R7.2). */
  totalMs: number;
  awayMs: number;
  /** Short breaks the app discarded without asking today. */
  autoDiscardedGaps?: number;
}

function dateLabel(range: RangeDto, locale: string): string {
  return new Date(range.from).toLocaleDateString(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function Card({ title, hint, children, label }: { title: string; hint?: string; children: React.ReactNode; label?: string }) {
  return (
    <section aria-label={label ?? title} className="rounded-lg border border-border bg-background p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
        {hint && <p className="truncate text-2xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** Today dashboard (presentational): totals, SVG timeline, by app and by activity. */
export function TodayView({
  intro,
  focus,
  goals,
  hasGoals = false,
  emptyAction,
  onOpenActivities,
  range,
  now,
  state,
  dark,
  loading,
  error,
  items,
  apps,
  activities,
  totalMs,
  awayMs,
  autoDiscardedGaps = 0,
}: Props) {
  const t = useT();
  const locale = useLocale();
  const empty = !loading && !error && items.length === 0 && totalMs === 0;
  const window = timelineWindow(items, range, now);
  const blocks = layoutTimeline(items, window, now, t);
  const presence = totalMs + awayMs;
  const activePct = presence > 0 ? (totalMs / presence) * 100 : 0;

  return (
    <Page
      title={t.shell.sections.today}
      subtitle={dateLabel(range, locale)}
      intro={intro}
      actions={
        state && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full ${state === "running" ? "bg-success" : "bg-muted-foreground/50"}`}
            />
            {stateLabel(state, t)}
          </span>
        )
      }
    >
      {error ? (
        <Alert variant="warning" role="alert">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <AlertDescription>{t.today.loadError(error)}</AlertDescription>
        </Alert>
      ) : loading ? (
        <div className="space-y-4" aria-label={t.today.loading}>
          <Skeleton className="h-24" />
          <Skeleton className="h-32" />
          <Skeleton className="h-40" />
        </div>
      ) : empty ? (
        <>
          <div className="empty:hidden mb-4">{focus}</div>
          {hasGoals && <div className="mb-4">{goals}</div>}
          <EmptyState
            title={t.today.empty.title}
            action={
              state === "running"
                ? onOpenActivities && { label: t.today.empty.setUpActivities, onClick: onOpenActivities }
                : emptyAction
            }
          >
            {state === "running" ? t.today.empty.running : t.today.empty.stopped}
          </EmptyState>
        </>
      ) : (
        <div className="space-y-4">
          {focus}
          {goals}
          <Card title={t.today.activeTime} hint={t.today.activeHint} label={t.today.activeAndAway}>
            <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
              <p
                data-testid="today-total"
                className="tabular text-display font-semibold tracking-tight"
                aria-label={t.today.activeTotal(formatDuration(totalMs))}
              >
                {formatClock(totalMs)}
              </p>
              <div className="min-w-48 flex-1 pb-1.5">
                <div
                  role="img"
                  aria-label={t.today.activeBar(formatDuration(totalMs), formatDuration(awayMs))}
                  className="flex h-1.5 overflow-hidden rounded-full bg-muted"
                >
                  <div className="h-full bg-primary" style={{ width: `${activePct}%` }} />
                </div>
                <dl className="mt-2 flex gap-6 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
                    <dt className="text-muted-foreground">{t.today.active}</dt>
                    <dd className="tabular font-medium">{formatDuration(totalMs)}</dd>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="size-2 rounded-full bg-muted-foreground/40" />
                    <dt className="text-muted-foreground">{t.today.away}</dt>
                    <dd className="tabular font-medium">{formatDuration(awayMs)}</dd>
                  </div>
                </dl>
              </div>
            </div>
            {autoDiscardedGaps > 0 && (
              <p data-testid="auto-discarded-hint" className="mt-3 text-xs text-muted-foreground">
                {t.today.autoDiscarded(autoDiscardedGaps)}
              </p>
            )}
          </Card>

          <Card title={t.today.timeline}>
            <DayTimeline window={window} blocks={blocks} now={now} dark={dark} />
          </Card>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Card title={t.today.byApp}>
              <AppList rows={apps} />
            </Card>
            <Card title={t.today.byActivity}>
              <ActivityList rows={activities} dark={dark} />
            </Card>
          </div>
        </div>
      )}
    </Page>
  );
}
