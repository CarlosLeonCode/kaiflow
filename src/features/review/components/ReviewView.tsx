import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { Heatmap } from "@/shared/charts/Heatmap";
import { RatioBar } from "@/shared/charts/RatioBar";
import type { WeeklyReviewDto } from "@/shared/ipc";
import { formatDuration } from "@/shared/lib/time";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Page } from "@/shared/ui/page";
import { Skeleton } from "@/shared/ui/skeleton";

import { BreakdownList } from "@/features/overview/components/BreakdownList";
import { activityRows, trendView } from "@/features/overview/lib/summary";
import type { WeekStart } from "@/features/overview/lib/periods";

import { focusWeek, focusWeekLine, goalWeekLine, isEmptyWeek, RESULT_LABEL, dayName, weekHeading } from "../lib/review";
import { WeekNav } from "./WeekNav";

interface Props {
  intro?: ReactNode;
  weeksAgo: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onThisWeek: () => void;
  loading: boolean;
  error: string | null;
  dark: boolean;
  /** First day of the week, for the heatmap rows. */
  weekStart: WeekStart;
  /** `undefined` while the first load is pending. */
  data: WeeklyReviewDto | undefined;
  /** The personal note editor (keyed by week by the container). */
  note: ReactNode;
  /** The optional AI analysis. */
  ai: ReactNode;
  onOpenGoals: () => void;
}

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="min-w-0 rounded-lg border border-border bg-background p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
        {hint && <p className="truncate text-2xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * Review section (presentational). Everything but the AI card is built on this computer, so
 * the week is useful with AI switched off, which is the default.
 */
export function ReviewView(props: Props) {
  const { data } = props;
  const trend = data ? trendView("week", data.dashboard.trend) : null;
  const empty = data ? isEmptyWeek(data) : false;
  return (
    <Page title="Review" subtitle="Your week, looked at calmly." intro={props.intro}>
      <div className="space-y-4">
        <WeekNav
          heading={weekHeading(props.weeksAgo)}
          label={data?.label ?? ""}
          canGoPrevious={props.canGoPrevious}
          canGoNext={props.canGoNext}
          isCurrent={props.weeksAgo === 0}
          onPrevious={props.onPrevious}
          onNext={props.onNext}
          onThisWeek={props.onThisWeek}
        />

        {props.error ? (
          <Alert variant="warning" role="alert">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <AlertDescription>Could not load the review: {props.error}</AlertDescription>
          </Alert>
        ) : props.loading || !data || !trend ? (
          <div className="space-y-4" aria-label="Loading review">
            <Skeleton className="h-28" />
            <Skeleton className="h-52" />
          </div>
        ) : (
          <>
            {empty ? (
              <EmptyState
                className="mt-6"
                title={props.weeksAgo === 0 ? "Nothing tracked this week yet" : "Nothing tracked this week"}
                action={props.weeksAgo === 0 ? undefined : { label: "Jump to this week", onClick: props.onThisWeek }}
              >
                Your review fills in as time is tracked. You can still write a note about this week below.
              </EmptyState>
            ) : (
              <>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                  <Card title="Summary">
                    <p
                      data-testid="review-total"
                      className="tabular text-display font-semibold tracking-tight"
                      aria-label={`Tracked time ${formatDuration(data.dashboard.total_ms)}`}
                    >
                      {formatDuration(data.dashboard.total_ms)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground" data-testid="review-comparison">
                      {trend.text}
                    </p>
                  </Card>
                  <Card title="Focus ratio">
                    <RatioBar
                      productiveMs={data.dashboard.productivity.productive_ms}
                      neutralMs={data.dashboard.productivity.neutral_ms}
                      distractingMs={data.dashboard.productivity.distracting_ms}
                      ratio={data.dashboard.focus_ratio}
                    />
                  </Card>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card title="By activity">
                    <BreakdownList
                      rows={activityRows(data.dashboard.by_activity, data.dashboard.total_ms).slice(0, 6)}
                      label="Time by activity"
                      dark={props.dark}
                      empty="No classified time."
                    />
                  </Card>
                  <Card title="Busiest hours" hint="Local time">
                    <Heatmap
                      cells={data.dashboard.heatmap}
                      weekStart={props.weekStart}
                      label="Tracked time by weekday and hour"
                    />
                  </Card>
                </div>
              </>
            )}

            <Card title="Goals" hint="How each goal fared this week">
              {data.goals.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No goals to review.{" "}
                  <button type="button" className="underline" onClick={props.onOpenGoals}>
                    Create a goal
                  </button>{" "}
                  to see how you do against it each week.
                </p>
              ) : (
                <ul aria-label="Goals this week" className="divide-y divide-border">
                  {data.goals.map((week) => (
                    <li key={week.goal.id} className="flex items-baseline justify-between gap-4 py-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{week.goal.label}</p>
                        <p className="text-xs text-muted-foreground">{goalWeekLine(week)}</p>
                        {week.goal.period === "daily" && (
                          <p className="mt-1 flex gap-1" aria-hidden="true">
                            {week.periods.map((p) => (
                              <span
                                key={p.start_day}
                                title={`${dayName(p.start_day)}: ${RESULT_LABEL[p.result]}`}
                                className={`rounded px-1 text-2xs ${
                                  p.result === "met"
                                    ? "bg-success/20 text-foreground"
                                    : p.result === "missed"
                                      ? "bg-warning text-warning-foreground"
                                      : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {dayName(p.start_day)}
                              </span>
                            ))}
                          </p>
                        )}
                      </div>
                      <p className="tabular shrink-0 text-xs text-muted-foreground">
                        Streak {week.current_streak} · best {week.best_streak}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Focus sessions">
              <p data-testid="review-focus" className="text-sm">
                {focusWeekLine(focusWeek(data.focus))}
              </p>
            </Card>

            <Card title="Your note" hint="Private. Never sent to an AI">
              {props.note}
            </Card>

            {props.ai}
          </>
        )}
      </div>
    </Page>
  );
}
