import { useMemo } from "react";

import { useNow } from "@/features/tracking/hooks/useNow";
import { useDismissMomentMutation, useProgressQuery } from "@/shared/ipc";
import { useLocale } from "@/shared/i18n";
import { localDayRange } from "@/shared/lib/time";

import { ProgressPanel } from "../components/ProgressPanel";
import { weekdayInitials } from "../lib/progress";

/** The Progress panel, wired to the progress query; nothing at all while progress is off. */
export function ProgressPanelContainer({ reveal = 0, className }: { reveal?: number; className?: string }) {
  const progress = useProgressQuery();
  const dismiss = useDismissMomentMutation();
  const locale = useLocale();
  const day = localDayRange(useNow(60_000)).from;
  const weekdays = useMemo(() => weekdayInitials(locale, day), [locale, day]);
  const data = progress.data;
  if (!data?.enabled) return null;
  return (
    <ProgressPanel
      progress={data}
      weekdays={weekdays}
      reveal={reveal}
      onDismissMoment={(moment) => dismiss.mutate(moment)}
      className={className}
    />
  );
}
