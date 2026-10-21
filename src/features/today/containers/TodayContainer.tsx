import { GoalsStrip } from "@/features/goals/components/GoalsStrip";
import { withLiveTime } from "@/features/goals/lib/goals";
import { SectionIntroContainer } from "@/features/shell/containers/SectionIntroContainer";
import { useMemo } from "react";

import { useNow } from "@/features/tracking/hooks/useNow";
import { elapsedSinceFetch, isAccruing } from "@/features/tracking/lib/derive";
import {
  errorMessage,
  useGoalsStatusQuery,
  useMarkGoalSeenMutation,
  useReportQuery,
  useStatusQuery,
  useTimelineQuery,
  useTrackingCommandMutation,
} from "@/shared/ipc";
import { localDayRange } from "@/shared/lib/time";
import { useIsDark } from "@/shared/lib/theme";

import { TodayView } from "../components/TodayView";
import { awayMs, buildAppRows, buildActivityRows, titleBreakdown } from "../lib/today";

interface Props {
  /** Takes the user to the Goals section (the strip's "Create a goal" and "All goals"). */
  onOpenGoals: () => void;
}

/** Wires Today to the backend: report + timeline of the local day, live while recording. */
export function TodayContainer({ onOpenGoals }: Props) {
  const now = useNow();
  const dayStart = localDayRange(now).from;
  const range = useMemo(() => localDayRange(dayStart), [dayStart]);
  const report = useReportQuery(range);
  const timeline = useTimelineQuery(range);
  const status = useStatusQuery();
  const dark = useIsDark();
  const tracking = useTrackingCommandMutation();
  const goals = useGoalsStatusQuery();
  const markSeen = useMarkGoalSeenMutation();

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
  const goalElapsed = goals.data ? elapsedSinceFetch(goals.dataUpdatedAt, now, accruing) : 0;
  const liveGoals = useMemo(
    () =>
      goals.data
        ? withLiveTime(goals.data, open ? { app_id: open.app_id, activity_id: open.activity_id } : null, goalElapsed)
        : undefined,
    [goals.data, open, goalElapsed],
  );
  const emptyAction =
    state === "stopped"
      ? { label: "Start tracking", onClick: () => tracking.mutate("start") }
      : state === "paused"
        ? { label: "Resume tracking", onClick: () => tracking.mutate("resume") }
        : undefined;

  return (
    <TodayView
      intro={<SectionIntroContainer section="today" />}
      goals={
        <GoalsStrip
          goals={liveGoals}
          onCreate={onOpenGoals}
          onOpenGoals={onOpenGoals}
          onMarkSeen={(goalId) => markSeen.mutate(goalId)}
        />
      }
      hasGoals={(goals.data?.length ?? 0) > 0}
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
      autoDiscardedGaps={report.data?.auto_discarded_gaps ?? 0}
    />
  );
}
