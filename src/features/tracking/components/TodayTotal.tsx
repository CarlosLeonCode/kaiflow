import type { ReactNode } from "react";

import { useT } from "@/shared/i18n";
import { formatClock } from "@/shared/lib/time";

interface Props {
  totalMs: number | undefined;
  live: boolean;
  /** Beside the total: the strokes chip. */
  aside?: ReactNode;
  /** At the right edge: Kai's badge. */
  badge?: ReactNode;
}

export function TodayTotal({ totalMs, live, aside, badge }: Props) {
  const today = useT().shell.sections.today;
  return (
    <section aria-label={today} className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{today}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p
            className="tabular text-display font-semibold tracking-tight"
            aria-live="off"
            data-testid="today-total"
            data-live={live}
          >
            {totalMs === undefined ? "–:––:––" : formatClock(totalMs)}
          </p>
          {aside}
        </div>
      </div>
      {badge}
    </section>
  );
}
