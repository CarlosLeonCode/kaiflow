import { useNow } from "@/features/tracking/hooks/useNow";
import {
  errorMessage,
  useAllowFocusAppMutation,
  useDismissFocusSummaryMutation,
  useExtendFocusMutation,
  useFocusStatusQuery,
  useSnoozeFocusMutation,
  useStopFocusMutation,
} from "@/shared/ipc";

import { ActiveSessionCard } from "../components/ActiveSessionCard";
import { SessionSummary } from "../components/SessionSummary";
import { SNOOZE_MINUTES } from "../lib/focus";

interface Props {
  /** The popover variant: a smaller card, and no summary (that lives in Today and Focus). */
  compact?: boolean;
}

/**
 * The running focus session (or, outside the popover, the summary of the last one until it is
 * dismissed). Renders nothing without either, so it can sit on any screen.
 */
export function FocusSessionContainer({ compact = false }: Props) {
  const status = useFocusStatusQuery();
  const stop = useStopFocusMutation();
  const extend = useExtendFocusMutation();
  const snooze = useSnoozeFocusMutation();
  const allow = useAllowFocusAppMutation();
  const dismiss = useDismissFocusSummaryMutation();
  const active = status.data?.active ?? null;
  // The countdown is the only thing that ticks, and only while a session runs.
  const now = useNow(active ? 1000 : 60_000);

  if (active) {
    const failed = stop.error ?? extend.error ?? snooze.error ?? allow.error;
    return (
      <ActiveSessionCard
        session={active}
        now={now}
        compact={compact}
        busy={stop.isPending || extend.isPending || snooze.isPending || allow.isPending}
        error={failed ? errorMessage(failed) : null}
        onEnd={() => stop.mutate()}
        onExtend={(minutes) => extend.mutate(minutes)}
        onAllowApp={(appId) => allow.mutate(appId)}
        onBackToIt={() => snooze.mutate(SNOOZE_MINUTES)}
      />
    );
  }
  const unseen = status.data?.unseen ?? null;
  if (!compact && unseen) {
    return <SessionSummary session={unseen} busy={dismiss.isPending} onDismiss={() => dismiss.mutate(unseen.id)} />;
  }
  return null;
}
