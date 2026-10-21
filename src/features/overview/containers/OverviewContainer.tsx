import { useMemo, useState } from "react";

import { SectionIntroContainer } from "@/features/shell/containers/SectionIntroContainer";
import { useNow } from "@/features/tracking/hooks/useNow";
import { errorMessage, useDashboardQuery, useExportJsonMutation } from "@/shared/ipc";
import { useIsDark } from "@/shared/lib/theme";

import { OverviewView } from "../components/OverviewView";
import {
  bucketsFor,
  canGoNext,
  periodLabel,
  periodRange,
  previousRange,
  shiftAnchor,
  type Period,
} from "../lib/periods";
import {
  activityRows,
  appRows,
  averages,
  bucketBars,
  bucketWords,
  busiest,
  titleRows,
  trendPoints,
  trendView,
} from "../lib/summary";

/**
 * Wires the Overview to the backend with one `get_dashboard` call per view. The frontend owns
 * the calendar: it computes local day, week and month boundaries (DST-safe) and sends UTC
 * ranges, the buckets to stack and the previous period; the backend folds everything in one
 * pass (design section 8).
 */
export function OverviewContainer() {
  const now = useNow(60_000);
  const dark = useIsDark();
  const [period, setPeriod] = useState<Period>("week");
  const [anchor, setAnchor] = useState(() => Date.now());

  const range = useMemo(() => periodRange(period, anchor), [period, anchor]);
  const previous = useMemo(() => previousRange(period, range), [period, range]);
  const buckets = useMemo(() => bucketsFor(period, range), [period, range]);

  const dashboard = useDashboardQuery(range, buckets, previous);
  const data = dashboard.data;

  const exportJson = useExportJsonMutation();
  const [exportedTo, setExportedTo] = useState<string | null>(null);

  const bars = useMemo(() => (data ? bucketBars(period, data) : []), [period, data]);
  const totalMs = data?.total_ms ?? 0;
  const current = range.from <= now && now < range.to;

  function clearExport() {
    setExportedTo(null);
    exportJson.reset();
  }

  function move(delta: number) {
    setAnchor(shiftAnchor(period, range, delta));
    clearExport();
  }

  return (
    <OverviewView
      intro={<SectionIntroContainer section="overview" />}
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
      loading={dashboard.isPending}
      error={dashboard.error ? errorMessage(dashboard.error) : null}
      dark={dark}
      data={data}
      trend={trendView(period, data?.trend ?? { kind: "no_comparison" })}
      averages={averages(bars)}
      busiest={busiest(bars)}
      bucket={bucketWords(period)}
      bars={bars}
      // Buckets that have not started yet would only draw a misleading flat line at zero.
      trendPoints={trendPoints(bars.filter((bar) => bar.range.from <= now))}
      activities={activityRows(data?.by_activity ?? [], totalMs)}
      apps={appRows(data?.by_app ?? [], totalMs)}
      titles={titleRows(data?.top_titles ?? [], totalMs)}
      exporting={exportJson.isPending}
      exportedTo={exportedTo}
      exportError={exportJson.error ? errorMessage(exportJson.error) : null}
      onExport={() => exportJson.mutate(range, { onSuccess: (path) => setExportedTo(path) })}
      onDismissExport={() => setExportedTo(null)}
    />
  );
}
