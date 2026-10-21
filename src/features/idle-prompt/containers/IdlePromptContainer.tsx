import {
  errorMessage,
  useActivitiesQuery,
  usePendingIdleGapsQuery,
  useResolveIdleGapMutation,
} from "@/shared/ipc";

import { IdlePromptCard } from "../components/IdlePromptCard";

/** Shows the oldest pending idle gap and resolves it through `resolve_idle_gap`. */
export function IdlePromptContainer() {
  const gaps = usePendingIdleGapsQuery();
  const activities = useActivitiesQuery();
  const resolve = useResolveIdleGapMutation();

  const [gap, ...rest] = [...(gaps.data ?? [])].sort((a, b) => a.started_at - b.started_at);
  if (!gap) return null;

  return (
    <IdlePromptCard
      // A fresh card (activity picker closed) for every gap.
      key={gap.id}
      gap={gap}
      moreCount={rest.length}
      activities={activities.data ?? []}
      busy={resolve.isPending}
      error={resolve.isError ? errorMessage(resolve.error) : null}
      onResolve={(resolution) => resolve.mutate({ id: gap.id, resolution })}
    />
  );
}
