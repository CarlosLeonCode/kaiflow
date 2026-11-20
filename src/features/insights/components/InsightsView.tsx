import type { ReactNode } from "react";
import { CircleAlert, Download, X } from "lucide-react";

import { useT } from "@/shared/i18n";
import { Heatmap } from "@/shared/charts/Heatmap";
import { RatioBar } from "@/shared/charts/RatioBar";
import { StackedBars } from "@/shared/charts/StackedBars";
import { TrendLine, type TrendPoint } from "@/shared/charts/TrendLine";
import type { Bar } from "@/shared/charts/types";
import type { DashboardDto } from "@/shared/ipc";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Page, type IntroSlot } from "@/shared/ui/page";
import { Segmented, type SegmentedOption } from "@/shared/ui/segmented";
import { Skeleton } from "@/shared/ui/skeleton";

import { GoalSummary } from "@/features/goals/components/GoalSummary";

import type { Period, WeekStart } from "../lib/periods";
import type { Averages, Row, TrendView } from "../lib/summary";
import { BreakdownList } from "./BreakdownList";
import { Card } from "./Card";
import { PeriodNav } from "./PeriodNav";
import { SummaryCard } from "./SummaryCard";

const PERIODS: readonly Period[] = ["day", "week", "month", "last90"];

interface Props {
  /** Section intro and its header help button, rendered by `Page`. */
  intro?: IntroSlot;
  period: Period;
  onPeriodChange: (period: Period) => void;
  label: string;
  canGoNext: boolean;
  isCurrent: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  /** Next step of an empty current period: set up activities while time is tracked. */
  onOpenActivities?: () => void;
  loading: boolean;
  error: string | null;
  dark: boolean;
  /** First day of the week, for the heatmap rows. */
  weekStart: WeekStart;
  onMarkGoalSeen: (goalId: number) => void;
  /** `undefined` while the first load is pending. */
  data: DashboardDto | undefined;
  trend: TrendView;
  averages: Averages;
  busiest: Bar | null;
  /** What one bar stands for. */
  bucket: "hour" | "day" | "week";
  bars: readonly Bar[];
  trendPoints: readonly TrendPoint[];
  activities: readonly Row[];
  apps: readonly Row[];
  titles: readonly Row[];
  exporting: boolean;
  /** Where the last export was saved; `null` when nothing to report. */
  exportedTo: string | null;
  exportError: string | null;
  onExport: () => void;
  onDismissExport: () => void;
  /** Week view only: the weekly review of the week on screen. */
  weekReview?: ReactNode;
}

/**
 * Insights section (presentational): period navigation, summary, charts and breakdowns. In the
 * Week view the container also passes `weekReview` (focus sessions, the note and the optional
 * AI analysis of that same week), drawn below the cards.
 */
export function InsightsView(props: Props) {
  const t = useT();
  const { period, loading, error, data } = props;
  const words = t.insights;
  const bucket = words.buckets[props.bucket];
  const totalMs = data?.total_ms ?? 0;
  const periods: SegmentedOption<Period>[] = PERIODS.map((value) => ({ value, label: words.periods[value] }));

  return (
    <Page
      title={t.shell.sections.insights}
      subtitle={words.subtitle}
      intro={props.intro}
      actions={
        <>
          <Segmented aria-label={words.periodLabel} value={period} options={periods} onChange={props.onPeriodChange} />
          <Button size="sm" onClick={props.onExport} disabled={props.exporting}>
            <Download aria-hidden="true" /> {words.exportJson}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <PeriodNav
          period={period}
          label={props.label}
          canGoNext={props.canGoNext}
          isCurrent={props.isCurrent}
          onPrevious={props.onPrevious}
          onNext={props.onNext}
          onToday={props.onToday}
        />

        {props.exportedTo && (
          <Alert variant="neutral" className="items-center justify-between">
            <span data-selectable className="min-w-0 truncate">
              {words.exportedTo(props.exportedTo)}
            </span>
            <Button variant="ghost" size="icon" aria-label={t.common.dismiss} onClick={props.onDismissExport}>
              <X />
            </Button>
          </Alert>
        )}
        {props.exportError && (
          <Alert variant="warning" role="alert">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <AlertDescription>{words.exportError(props.exportError)}</AlertDescription>
          </Alert>
        )}

        {error ? (
          <Alert variant="warning" role="alert">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <AlertDescription>{words.loadError(error)}</AlertDescription>
          </Alert>
        ) : loading || !data ? (
          <div className="space-y-4" aria-label={words.loading}>
            <Skeleton className="h-28" />
            <Skeleton className="h-52" />
          </div>
        ) : totalMs === 0 ? (
          <>
            <Card title={words.summary}>
              <SummaryCard
                period={period}
                totalMs={0}
                trend={props.trend}
                averages={props.averages}
                busiest={null}
                bucket={props.bucket}
              />
            </Card>
            <EmptyState
              className="mt-10"
              title={words.empty.title[period]}
              action={
                props.isCurrent
                  ? props.onOpenActivities && { label: t.today.empty.setUpActivities, onClick: props.onOpenActivities }
                  : { label: words.empty.jump[period], onClick: props.onToday }
              }
            >
              {props.isCurrent ? words.empty.current : words.empty.past[period]}
            </EmptyState>
          </>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <Card title={words.summary}>
                <SummaryCard
                  period={period}
                  totalMs={totalMs}
                  trend={props.trend}
                  averages={props.averages}
                  busiest={props.busiest?.fullLabel ?? null}
                  bucket={props.bucket}
                />
              </Card>
              <Card title={words.productiveTime}>
                <RatioBar
                  productiveMs={data.productivity.productive_ms}
                  neutralMs={data.productivity.neutral_ms}
                  distractingMs={data.productivity.distracting_ms}
                  ratio={data.focus_ratio}
                />
              </Card>
            </div>

            {data.goals.length > 0 && (
              <Card title={words.goals} hint={words.goalsHint}>
                <ul aria-label={t.goals.progress} className="divide-y divide-border">
                  {data.goals.map((status) => (
                    <GoalSummary key={status.goal.id} status={status} onMarkSeen={props.onMarkGoalSeen} />
                  ))}
                </ul>
              </Card>
            )}

            <Card title={bucket.title}>
              <StackedBars bars={props.bars} dark={props.dark} label={bucket.chart} />
            </Card>

            {period !== "day" && (
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title={words.busiestHours} hint={words.localTime}>
                  <Heatmap cells={data.heatmap} weekStart={props.weekStart} label={words.heatmapLabel} />
                </Card>
                <Card title={words.trend}>
                  <TrendLine points={props.trendPoints} label={bucket.trend} />
                </Card>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title={words.byActivity}>
                <BreakdownList
                  rows={props.activities}
                  label={words.timeByActivity}
                  dark={props.dark}
                  empty={words.noActivityTime}
                />
              </Card>
              <Card title={words.byApp}>
                <BreakdownList rows={props.apps} label={words.timeByApp} dark={props.dark} empty={words.noAppTime} />
              </Card>
            </div>

            <Card title={words.topTitles}>
              <BreakdownList
                rows={props.titles}
                label={words.timeByTitle}
                dark={props.dark}
                empty={words.noTitles}
              />
            </Card>
          </>
        )}

        {props.weekReview}
      </div>
    </Page>
  );
}
