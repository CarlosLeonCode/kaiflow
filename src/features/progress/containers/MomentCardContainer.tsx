import { useDismissMomentMutation, useProgressQuery, type MomentDto } from "@/shared/ipc";

import { ProgressMoment } from "../components/ProgressMoment";

/**
 * The one moment to celebrate, if there is one and progress is on. Dismissing it updates the
 * shared progress query, so the card leaves every window that shows it.
 */
export function MomentCardContainer({ onOpen }: { onOpen: (moment: MomentDto) => void }) {
  const progress = useProgressQuery();
  const dismiss = useDismissMomentMutation();
  const data = progress.data;
  if (!data?.enabled || !data.moment) return null;
  return (
    <ProgressMoment
      moment={data.moment}
      seals={data.seals}
      onOpen={onOpen}
      onDismiss={(moment) => dismiss.mutate(moment)}
    />
  );
}
