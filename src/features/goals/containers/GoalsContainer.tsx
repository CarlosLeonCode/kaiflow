import { useMemo } from "react";

import { toSubmitResult, type SubmitResult } from "@/features/activities/lib/submit";
import { SectionIntroContainer } from "@/features/shell/containers/SectionIntroContainer";
import { useNow } from "@/features/tracking/hooks/useNow";
import {
  errorMessage,
  useActivitiesQuery,
  useDeleteGoalMutation,
  useGoalsQuery,
  useGoalsStatusQuery,
  useMarkGoalSeenMutation,
  useReportQuery,
  useUpsertGoalMutation,
} from "@/shared/ipc";
import { appName, appOptions, RECENT_APP_DAYS } from "@/shared/lib/apps";
import { activityLabel } from "@/shared/lib/labels";
import { addLocalDays } from "@/shared/lib/time";

import { GoalsView } from "../components/GoalsView";
import type { NameLookup } from "../lib/goals";

async function attempt(action: () => Promise<unknown>): Promise<SubmitResult> {
  try {
    await action();
    return null;
  } catch (error) {
    return toSubmitResult(error);
  }
}

/** Wires Goals to the backend: the goals, their progress, the activities and the recent apps. */
export function GoalsContainer() {
  const now = useNow(60_000);
  const today = addLocalDays(now, 0);
  const range = useMemo(() => ({ from: addLocalDays(today, -RECENT_APP_DAYS), to: addLocalDays(today, 1) }), [today]);
  const goals = useGoalsQuery();
  const statuses = useGoalsStatusQuery();
  const activities = useActivitiesQuery();
  const recent = useReportQuery(range);
  const save = useUpsertGoalMutation();
  const remove = useDeleteGoalMutation();
  const markSeen = useMarkGoalSeenMutation();

  const apps = useMemo(() => appOptions(recent.data?.by_app ?? []), [recent.data]);
  const activityList = useMemo(() => activities.data ?? [], [activities.data]);
  const names = useMemo<NameLookup>(
    () => ({
      activity: (id) => {
        const found = activityList.find((activity) => activity.id === id);
        return found ? activityLabel(found.id, found.name) : "a deleted activity";
      },
      app: (id) => appName(apps, id),
    }),
    [activityList, apps],
  );

  const failure = goals.error ?? statuses.error ?? activities.error;
  const archived = useMemo(() => (goals.data ?? []).filter((goal) => goal.archived), [goals.data]);

  return (
    <GoalsView
      intro={<SectionIntroContainer section="goals" />}
      loading={goals.isPending || statuses.isPending || activities.isPending}
      error={failure ? errorMessage(failure) : null}
      statuses={statuses.data ?? []}
      archived={archived}
      activities={activityList}
      apps={apps}
      names={names}
      onSave={(goal) => attempt(() => save.mutateAsync(goal))}
      onDelete={(id) => attempt(() => remove.mutateAsync(id))}
      onMarkSeen={(goalId) => markSeen.mutate(goalId)}
    />
  );
}
