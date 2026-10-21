import { SectionIntroContainer } from "@/features/shell/containers/SectionIntroContainer";
import { useMemo, useState } from "react";

import { useNow } from "@/features/tracking/hooks/useNow";
import {
  errorMessage,
  useExportCsvMutation,
  useReportQuery,
  useReportsQuery,
} from "@/shared/ipc";
import { useIsDark } from "@/shared/lib/theme";

import { HistoryView } from "../components/HistoryView";
import {
  bucketsFor,
  canGoNext,
  dayRanges,
  hourRanges,
  periodLabel,
  periodRange,
  previousRange,
  shiftPeriod,
  type Period,
} from "../lib/periods";
import {
  appRows,
  averages,
  busiest,
  activityRows,
  compareTotals,
  dayBars,
  hourBars,
} from "../lib/summary";

/**
 * Wires History to the backend. The frontend owns the calendar: it computes local day, week
 * and month boundaries (DST-safe) and sends UTC ranges; the backend only sums segments clipped
 * to them (design section 8). Week and month fetch one small report per day so each bar can
 * be stacked by activity.
 */
export function HistoryContainer() {
  const now = useNow(60_000);
  const dark = useIsDark();
  const [period, setPeriod] = useState<Period>("week");
  const [anchor, setAnchor] = useState(() => Date.now());

  const range = useMemo(() => periodRange(period, anchor), [period, anchor]);
  const previous = useMemo(() => previousRange(period, range), [period, range]);
  const buckets = useMemo(() => bucketsFor(period, range), [period, range]);
  const days = useMemo(() => dayRanges(range), [range]);

  const report = useReportQuery(range, buckets);
  const previousReport = useReportQuery(previous);
  const dayReports = useReportsQuery(days, period !== "day");

  const exportCsv = useExportCsvMutation();
  const [exportedTo, setExportedTo] = useState<string | null>(null);

  const bars =
    period === "day"
      ? hourBars(report.data, hourRanges(range))
      : dayBars(
          period,
          days,
          dayReports.map((query) => query.data),
        );

  const totalMs = report.data?.total_ms ?? 0;
  const failure = report.error ?? previousReport.error ?? dayReports.find((query) => query.error)?.error;
  const loading = report.isPending || previousReport.isPending;
  const current = range.from <= now && now < range.to;

  function clearExport() {
    setExportedTo(null);
    exportCsv.reset();
  }

  function move(delta: number) {
    setAnchor(shiftPeriod(period, range.from, delta));
    clearExport();
  }

  return (
    <HistoryView
      intro={<SectionIntroContainer section="history" />}
      period={period}
      onPeriodChange={(next) => {
        setPeriod(next);
        clearExport();
      }}
      label={periodLabel(period, range)}
      canGoNext={canGoNext(period, range, now)}
      isCurrent={current}
      onPrevious={() => move(-1)}
      onNext={() => move(1)}
      onToday={() => {
        setAnchor(Date.now());
        clearExport();
      }}
      loading={loading}
      error={failure ? errorMessage(failure) : null}
      dark={dark}
      totalMs={totalMs}
      comparison={compareTotals(totalMs, previousReport.data?.total_ms ?? 0)}
      averages={averages(bars)}
      busiest={busiest(bars)}
      bars={bars}
      activities={activityRows(report.data?.by_activity ?? [], totalMs)}
      apps={appRows(report.data?.by_app ?? [], totalMs)}
      exporting={exportCsv.isPending}
      exportedTo={exportedTo}
      exportError={exportCsv.error ? errorMessage(exportCsv.error) : null}
      onExport={() => exportCsv.mutate(range, { onSuccess: (path) => setExportedTo(path) })}
      onDismissExport={() => setExportedTo(null)}
    />
  );
}
