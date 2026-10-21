import type { ReactNode } from "react";
import { CircleAlert, Download, X } from "lucide-react";

import { Heatmap } from "@/shared/charts/Heatmap";
import { RatioBar } from "@/shared/charts/RatioBar";
import { StackedBars } from "@/shared/charts/StackedBars";
import { TrendLine, type TrendPoint } from "@/shared/charts/TrendLine";
import type { Bar } from "@/shared/charts/types";
import type { DashboardDto } from "@/shared/ipc";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Page } from "@/shared/ui/page";
import { Segmented, type SegmentedOption } from "@/shared/ui/segmented";
import { Skeleton } from "@/shared/ui/skeleton";

import { periodNoun, type Period } from "../lib/periods";
import type { Averages, Row, TrendView } from "../lib/summary";
import { BreakdownList } from "./BreakdownList";
import { PeriodNav } from "./PeriodNav";
import { SummaryCard } from "./SummaryCard";

const PERIODS: readonly SegmentedOption<Period>[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "last90", label: "90 days" },
];

interface Props {
  /** Dismissible section introduction, rendered by `Page`. */
  intro?: ReactNode;
  period: Period;
  onPeriodChange: (period: Period) => void;
  label: string;
  canGoNext: boolean;
  isCurrent: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  loading: boolean;
  error: string | null;
  dark: boolean;
  /** `undefined` while the first load is pending. */
  data: DashboardDto | undefined;
  trend: TrendView;
  averages: Averages;
  busiest: Bar | null;
  bucket: { singular: string; plural: string };
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
}

function Card({ title, hint, children, className }: { title: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`min-w-0 rounded-lg border border-border bg-background p-4 ${className ?? ""}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
        {hint && <p className="truncate text-2xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** Overview section (presentational): period navigation, summary, charts and breakdowns. */
export function OverviewView(props: Props) {
  const { period, loading, error, data } = props;
  const noun = periodNoun(period);
  const totalMs = data?.total_ms ?? 0;
  const chartLabel =
    period === "day"
      ? "Tracked time per hour, stacked by activity"
      : period === "last90"
        ? "Tracked time per week, stacked by activity"
        : "Tracked time per day, stacked by activity";
  const bucketTitle = period === "day" ? "By hour" : period === "last90" ? "By week" : "By day";

  return (
    <Page
      title="Overview"
      subtitle="Where your time went, and how it compares."
      intro={props.intro}
      actions={
        <>
          <Segmented aria-label="Period" value={period} options={PERIODS} onChange={props.onPeriodChange} />
          <Button size="sm" onClick={props.onExport} disabled={props.exporting}>
            <Download aria-hidden="true" /> Export CSV
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
              Exported to {props.exportedTo}
            </span>
            <Button variant="ghost" size="icon" aria-label="Dismiss" onClick={props.onDismissExport}>
              <X />
            </Button>
          </Alert>
        )}
        {props.exportError && (
          <Alert variant="warning" role="alert">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <AlertDescription>Could not export: {props.exportError}</AlertDescription>
          </Alert>
        )}

        {error ? (
          <Alert variant="warning" role="alert">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <AlertDescription>Could not load the overview: {error}</AlertDescription>
          </Alert>
        ) : loading || !data ? (
          <div className="space-y-4" aria-label="Loading overview">
            <Skeleton className="h-28" />
            <Skeleton className="h-52" />
          </div>
        ) : totalMs === 0 ? (
          <>
            <Card title="Summary">
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
              title={`Nothing tracked this ${noun}`}
              action={props.isCurrent ? undefined : { label: `Jump to this ${noun}`, onClick: props.onToday }}
            >
              Try another period, or let tracking run for a while: your time shows up here as it happens.
            </EmptyState>
          </>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <Card title="Summary">
                <SummaryCard
                  period={period}
                  totalMs={totalMs}
                  trend={props.trend}
                  averages={props.averages}
                  busiest={props.busiest?.fullLabel ?? null}
                  bucket={props.bucket}
                />
              </Card>
              <Card title="Focus ratio">
                <RatioBar
                  productiveMs={data.productivity.productive_ms}
                  neutralMs={data.productivity.neutral_ms}
                  distractingMs={data.productivity.distracting_ms}
                  ratio={data.focus_ratio}
                />
              </Card>
            </div>

            <Card title={bucketTitle}>
              <StackedBars bars={props.bars} dark={props.dark} label={chartLabel} />
            </Card>

            {period !== "day" && (
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Busiest hours" hint="Local time">
                  <Heatmap cells={data.heatmap} label="Tracked time by weekday and hour" />
                </Card>
                <Card title="Trend">
                  <TrendLine points={props.trendPoints} label={`Tracked time per ${props.bucket.singular}`} />
                </Card>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="By activity">
                <BreakdownList rows={props.activities} label="Time by activity" dark={props.dark} empty="No classified time." />
              </Card>
              <Card title="By app">
                <BreakdownList rows={props.apps} label="Time by app" dark={props.dark} empty="No app time." />
              </Card>
            </div>

            <Card title="Top window titles">
              <BreakdownList
                rows={props.titles}
                label="Time by window title"
                dark={props.dark}
                empty="No window titles in this period. Titles are only saved while the Privacy setting allows it."
              />
            </Card>
          </>
        )}
      </div>
    </Page>
  );
}
