import { useMemo } from "react";

import { useNow } from "@/features/tracking/hooks/useNow";
import { elapsedSinceFetch, isAccruing } from "@/features/tracking/lib/derive";
import { errorMessage, useReportQuery, useStatusQuery, useTimelineQuery } from "@/shared/ipc";
import { localDayRange } from "@/shared/lib/time";
import { useIsDark } from "@/shared/lib/theme";

import { TodayView } from "../components/TodayView";
import { awayMs, buildAppRows, buildCategoryRows, titleBreakdown } from "../lib/today";

/** Wires Today to the backend: report + timeline of the local day, live while recording. */
export function TodayContainer() {
  const now = useNow();
  const dayStart = localDayRange(now).from;
  const range = useMemo(() => localDayRange(dayStart), [dayStart]);
  const report = useReportQuery(range);
  const timeline = useTimelineQuery(range);
  const status = useStatusQuery();
  const dark = useIsDark();

  const items = useMemo(() => timeline.data ?? [], [timeline.data]);
  const accruing = isAccruing(status.data?.state);
  const elapsed = report.data ? elapsedSinceFetch(report.dataUpdatedAt, now, accruing) : 0;
  const open = items.find((item) => item.open);
  const totalMs = (report.data?.total_ms ?? 0) + elapsed;

  const titles = useMemo(() => titleBreakdown(items, range, now), [items, range, now]);
  const apps = buildAppRows(report.data?.by_app ?? [], open, elapsed, titles);
  const categories = buildCategoryRows(report.data?.by_category ?? [], open, elapsed, totalMs);
  const failure = report.error ?? timeline.error;

  return (
    <TodayView
      range={range}
      now={now}
      state={status.data?.state}
      dark={dark}
      loading={report.isPending || timeline.isPending}
      error={failure ? errorMessage(failure) : null}
      items={items}
      apps={apps}
      categories={categories}
      totalMs={totalMs}
      awayMs={awayMs(items, range, now)}
    />
  );
}
