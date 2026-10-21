import { useMemo } from "react";

import { toSubmitResult, type SubmitResult } from "@/features/activities/lib/submit";
import { useSectionIntro } from "@/features/shell/hooks/useSectionIntro";
import { useNow } from "@/features/tracking/hooks/useNow";
import {
  errorMessage,
  useActivitiesQuery,
  useDismissFocusSummaryMutation,
  useFocusHistoryQuery,
  useFocusStatusQuery,
  useReportQuery,
  useStartFocusMutation,
  type FocusStartDto,
} from "@/shared/ipc";
import { appOptions, RECENT_APP_DAYS } from "@/shared/lib/apps";
import { addLocalDays } from "@/shared/lib/time";

import { FocusStartPanel } from "../components/FocusStartPanel";
import { FocusView } from "../components/FocusView";
import { SessionSummary } from "../components/SessionSummary";
import { todayStats } from "../lib/focus";
import { FocusSessionContainer } from "./FocusSessionContainer";

/** Wires the Focus section: today's numbers, the timer or the start view, the last summary, history. */
export function FocusContainer() {
  const intro = useSectionIntro("focus");
  const now = useNow(60_000);
  const today = addLocalDays(now, 0);
  const tomorrow = addLocalDays(now, 1);
  const range = useMemo(() => ({ from: addLocalDays(today, -RECENT_APP_DAYS), to: addLocalDays(today, 1) }), [today]);
  const status = useFocusStatusQuery();
  const history = useFocusHistoryQuery();
  const activities = useActivitiesQuery();
  const recent = useReportQuery(range);
  const start = useStartFocusMutation();
  const dismiss = useDismissFocusSummaryMutation();

  const apps = useMemo(() => appOptions(recent.data?.by_app ?? []), [recent.data]);
  const stats = useMemo(() => todayStats(history.data ?? [], today, tomorrow), [history.data, today, tomorrow]);
  const unseen = status.data?.unseen ?? null;
  const busy = status.data?.active != null || status.data?.card != null;

  async function submit(request: FocusStartDto): Promise<SubmitResult> {
    try {
      await start.mutateAsync(request);
      return null;
    } catch (error) {
      return toSubmitResult(error);
    }
  }

  const failure = status.error ?? history.error;
  return (
    <FocusView
      intro={intro}
      loading={status.isPending || history.isPending}
      error={failure ? errorMessage(failure) : null}
      unavailable={status.data?.unavailable ?? null}
      today={stats}
      main={
        busy ? (
          <FocusSessionContainer variant="section" />
        ) : (
          <FocusStartPanel
            activities={activities.data ?? []}
            apps={apps}
            driftUnavailable={status.data?.unavailable != null}
            onSubmit={submit}
          />
        )
      }
      summary={
        status.data?.active == null && unseen ? (
          <SessionSummary session={unseen} busy={dismiss.isPending} onDismiss={() => dismiss.mutate(unseen.id)} />
        ) : null
      }
      history={history.data ?? []}
    />
  );
}
