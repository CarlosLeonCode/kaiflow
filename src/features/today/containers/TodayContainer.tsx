import { SectionIntroContainer } from "@/features/shell/containers/SectionIntroContainer";
import { useMemo } from "react";

import { useNow } from "@/features/tracking/hooks/useNow";
import { elapsedSinceFetch, isAccruing } from "@/features/tracking/lib/derive";
import {
  errorMessage,
  useReportQuery,
  useStatusQuery,
  useTimelineQuery,
  useTrackingCommandMutation,
} from "@/shared/ipc";
import { localDayRange } from "@/shared/lib/time";
import { useIsDark } from "@/shared/lib/theme";

import { TodayView } from "../components/TodayView";
import { awayMs, buildAppRows, buildActivityRows, titleBreakdown } from "../lib/today";

/** Wires Today to the backend: report + timeline of the local day, live while recording. */
export function TodayContainer() {
  const now = useNow();
  const dayStart = localDayRange(now).from;
  const range = useMemo(() => localDayRange(dayStart), [dayStart]);
  const report = useReportQuery(range);
  const timeline = useTimelineQuery(range);
  const status = useStatusQuery();
  const dark = useIsDark();
  const tracking = useTrackingCommandMutation();

  const items = useMemo(() => timeline.data ?? [], [timeline.data]);
  const accruing = isAccruing(status.data?.state);
  const elapsed = report.data ? elapsedSinceFetch(report.dataUpdatedAt, now, accruing) : 0;
  const open = items.find((item) => item.open);
  const totalMs = (report.data?.total_ms ?? 0) + elapsed;

  const titles = useMemo(() => titleBreakdown(items, range, now), [items, range, now]);
  const apps = buildAppRows(report.data?.by_app ?? [], open, elapsed, titles);
  const activities = buildActivityRows(report.data?.by_activity ?? [], open, elapsed, totalMs);
  const failure = report.error ?? timeline.error;
  const state = status.data?.state;
  const emptyAction =
    state === "stopped"
      ? { label: "Start tracking", onClick: () => tracking.mutate("start") }
      : state === "paused"
        ? { label: "Resume tracking", onClick: () => tracking.mutate("resume") }
        : undefined;

  return (
    <TodayView
      intro={<SectionIntroContainer section="today" />}
      range={range}
      now={now}
      state={state}
      emptyAction={emptyAction}
      dark={dark}
      loading={report.isPending || timeline.isPending}
      error={failure ? errorMessage(failure) : null}
      items={items}
      apps={apps}
      activities={activities}
      totalMs={totalMs}
      awayMs={awayMs(items, range, now)}
    />
  );
}
