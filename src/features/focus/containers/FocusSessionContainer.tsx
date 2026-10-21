import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useNow } from "@/features/tracking/hooks/useNow";
import {
  errorMessage,
  queryKeys,
  useAllowFocusAppMutation,
  useDismissFocusSummaryMutation,
  useExtendFocusMutation,
  useFocusCardActionMutation,
  useFocusStatusQuery,
  usePauseFocusMutation,
  useResumeFocusMutation,
  useSnoozeFocusMutation,
  useStartFocusMutation,
  useStopFocusMutation,
  type FocusCycleDto,
} from "@/shared/ipc";

import { ActiveTimerCard } from "../components/ActiveTimerCard";
import { EndCard } from "../components/EndCard";
import { QuickStart } from "../components/QuickStart";
import { SessionSummary } from "../components/SessionSummary";
import { SNOOZE_MINUTES, quickTimer, remainingMs } from "../lib/focus";

/**
 * - `popover`: compact cards, and the one-click quick start when nothing runs.
 * - `page` (Today): full cards, and the summary of the last focus block until dismissed.
 * - `section` (Focus): full cards only; the section shows its own start view and summary.
 */
export type FocusVariant = "popover" | "page" | "section";

const NO_CYCLE: FocusCycleDto = { enabled: false, round: 0, every: 4 };
/** After the countdown hits zero, look again once the watcher had time to end the block. */
const END_REFETCH_MS = 1_500;

/** The running block, the end card waiting for an answer, or (by variant) how to start one. */
export function FocusSessionContainer({ variant = "page" }: { variant?: FocusVariant }) {
  const client = useQueryClient();
  const status = useFocusStatusQuery();
  const start = useStartFocusMutation();
  const stop = useStopFocusMutation();
  const extend = useExtendFocusMutation();
  const pause = usePauseFocusMutation();
  const resume = useResumeFocusMutation();
  const snooze = useSnoozeFocusMutation();
  const allow = useAllowFocusAppMutation();
  const cardAction = useFocusCardActionMutation();
  const dismiss = useDismissFocusSummaryMutation();
  const active = status.data?.active ?? null;
  const card = status.data?.card ?? null;
  const cycle = status.data?.cycle ?? NO_CYCLE;
  const ticking = active !== null && active.paused_at === null;
  // The countdown is the only thing that ticks, and only while a block runs.
  const now = useNow(ticking ? 1000 : 60_000);
  const timeUp = ticking && remainingMs(active, now) <= 0;

  useEffect(() => {
    if (!timeUp) return;
    // The focus-changed event normally arrives first; this is the fallback.
    const id = window.setTimeout(() => void client.invalidateQueries({ queryKey: queryKeys.focus }), END_REFETCH_MS);
    return () => window.clearTimeout(id);
  }, [timeUp, client]);

  const compact = variant === "popover";
  if (active) {
    const failed = stop.error ?? extend.error ?? pause.error ?? resume.error ?? snooze.error ?? allow.error;
    return (
      <ActiveTimerCard
        session={active}
        now={now}
        cycle={cycle}
        compact={compact}
        busy={stop.isPending || extend.isPending || pause.isPending || resume.isPending || snooze.isPending || allow.isPending}
        error={failed ? errorMessage(failed) : null}
        onPause={() => pause.mutate()}
        onResume={() => resume.mutate()}
        onEnd={() => stop.mutate()}
        onExtend={(minutes) => extend.mutate(minutes)}
        onAllowApp={(appId) => allow.mutate(appId)}
        onBackToIt={() => snooze.mutate(SNOOZE_MINUTES)}
      />
    );
  }
  if (card) {
    return (
      <EndCard
        card={card}
        cycle={cycle}
        compact={compact}
        busy={cardAction.isPending}
        error={cardAction.error ? errorMessage(cardAction.error) : null}
        onStartNext={() => cardAction.mutate({ kind: "start_next" })}
        onSkip={() => cardAction.mutate({ kind: "skip" })}
        onMoreTime={(minutes) => cardAction.mutate({ kind: "more_time", minutes })}
      />
    );
  }
  if (variant === "popover") {
    // Without a status there is nothing sensible to start from (the backend is unreachable).
    if (!status.data) return null;
    return (
      <QuickStart
        busy={start.isPending}
        error={start.error ? errorMessage(start.error) : null}
        onStart={(minutes, intent) => start.mutate(quickTimer(minutes, intent))}
      />
    );
  }
  const unseen = status.data?.unseen ?? null;
  if (variant === "page" && unseen) {
    return <SessionSummary session={unseen} busy={dismiss.isPending} onDismiss={() => dismiss.mutate(unseen.id)} />;
  }
  return null;
}
