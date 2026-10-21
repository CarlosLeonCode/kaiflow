import { useMemo, useState } from "react";

import { toSubmitResult, type SubmitResult } from "@/features/activities/lib/submit";
import { SectionIntroContainer } from "@/features/shell/containers/SectionIntroContainer";
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
import { Dialog } from "@/shared/ui/dialog";

import { FocusStartForm } from "../components/FocusStartForm";
import { FocusView } from "../components/FocusView";
import { SessionSummary } from "../components/SessionSummary";
import { FocusSessionContainer } from "./FocusSessionContainer";

/** Wires the Focus section: the running session, the last summary, the history and the start dialog. */
export function FocusContainer() {
  const now = useNow(60_000);
  const today = addLocalDays(now, 0);
  const range = useMemo(() => ({ from: addLocalDays(today, -RECENT_APP_DAYS), to: addLocalDays(today, 1) }), [today]);
  const status = useFocusStatusQuery();
  const history = useFocusHistoryQuery();
  const activities = useActivitiesQuery();
  const recent = useReportQuery(range);
  const start = useStartFocusMutation();
  const dismiss = useDismissFocusSummaryMutation();
  const [dialogOpen, setDialogOpen] = useState(false);

  const apps = useMemo(() => appOptions(recent.data?.by_app ?? []), [recent.data]);
  const unseen = status.data?.unseen ?? null;
  const running = status.data?.active != null;

  async function submit(request: FocusStartDto): Promise<SubmitResult> {
    try {
      await start.mutateAsync(request);
      setDialogOpen(false);
      return null;
    } catch (error) {
      return toSubmitResult(error);
    }
  }

  const failure = status.error ?? history.error;
  return (
    <FocusView
      intro={<SectionIntroContainer section="focus" />}
      loading={status.isPending || history.isPending}
      error={failure ? errorMessage(failure) : null}
      unavailable={status.data?.unavailable ?? null}
      running={running}
      activeCard={running ? <FocusSessionContainer /> : null}
      summary={
        !running && unseen ? (
          <SessionSummary session={unseen} busy={dismiss.isPending} onDismiss={() => dismiss.mutate(unseen.id)} />
        ) : null
      }
      history={history.data ?? []}
      onStart={() => setDialogOpen(true)}
      dialog={
        <Dialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title="Start a focus session"
          description="Choose what you are working on and what counts as being on track."
        >
          <FocusStartForm
            activities={activities.data ?? []}
            apps={apps}
            onSubmit={submit}
            onCancel={() => setDialogOpen(false)}
          />
        </Dialog>
      }
      />
  );
}
