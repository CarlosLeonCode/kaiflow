import { CircleAlert, Download, X } from "lucide-react";

import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Page } from "@/shared/ui/page";
import { Segmented, type SegmentedOption } from "@/shared/ui/segmented";
import { Skeleton } from "@/shared/ui/skeleton";

import { periodNoun, type Period } from "../lib/periods";
import type { Averages, Bar, Comparison, Row } from "../lib/summary";
import { BreakdownList } from "./BreakdownList";
import { PeriodNav } from "./PeriodNav";
import { PeriodSummary } from "./PeriodSummary";
import { StackedBars } from "./StackedBars";

const PERIODS: readonly SegmentedOption<Period>[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

interface Props {
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
  totalMs: number;
  comparison: Comparison;
  averages: Averages;
  busiest: Bar | null;
  bars: readonly Bar[];
  categories: readonly Row[];
  apps: readonly Row[];
  exporting: boolean;
  /** Where the last export was saved; `null` when nothing to report. */
  exportedTo: string | null;
  exportError: string | null;
  onExport: () => void;
  onDismissExport: () => void;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-lg border border-border bg-background p-4">
      <h2 className="mb-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

/** History section (presentational): navigation, totals, stacked bars and breakdowns. */
export function HistoryView(props: Props) {
  const { period, loading, error, totalMs } = props;
  const noun = periodNoun(period);
  const chartLabel = period === "day" ? "Focused time per hour" : "Focused time per day, stacked by category";

  return (
    <Page
      title="History"
      subtitle="Browse past days, weeks and months."
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
            <AlertDescription>Could not load history: {error}</AlertDescription>
          </Alert>
        ) : loading ? (
          <div className="space-y-4" aria-label="Loading history">
            <Skeleton className="h-24" />
            <Skeleton className="h-52" />
          </div>
        ) : (
          <>
            <Card title="Summary">
              <PeriodSummary
                period={period}
                totalMs={totalMs}
                comparison={props.comparison}
                averages={props.averages}
                busiest={props.busiest}
              />
            </Card>

            {totalMs === 0 ? (
              <div className="mx-auto mt-10 max-w-sm text-center">
                <h2 className="text-lg font-semibold">{`Nothing tracked this ${noun}`}</h2>
                <p className="mt-1 text-muted-foreground">
                  Try another {noun}. Exporting still works and gives you a file with just the header row.
                </p>
              </div>
            ) : (
              <>
                <Card title={period === "day" ? "By hour" : "By day"}>
                  <StackedBars bars={props.bars} dark={props.dark} label={chartLabel} />
                </Card>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card title="By category">
                    <BreakdownList
                      rows={props.categories}
                      label="Time by category"
                      dark={props.dark}
                      empty="No categorized time."
                    />
                  </Card>
                  <Card title="By app">
                    <BreakdownList rows={props.apps} label="Time by app" dark={props.dark} empty="No app time." />
                  </Card>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Page>
  );
}
