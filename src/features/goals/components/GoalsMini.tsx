import { useT } from "@/shared/i18n";
import type { GoalStatusDto } from "@/shared/ipc";

import { streakText, topGoals, unseenLabel } from "../lib/goals";
import { GoalBar } from "./GoalBar";

/** Goals shown in the menu-bar popover. */
export const MINI_LIMIT = 2;

/** The two goals most worth a glance in the popover; nothing at all when there are none. */
export function GoalsMini({ goals }: { goals: readonly GoalStatusDto[] }) {
  const t = useT();
  if (goals.length === 0) return null;
  return (
    <section aria-label={t.shell.sections.goals} className="mt-4 px-4">
      <h2 className="mb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">{t.shell.sections.goals}</h2>
      <ul aria-label={t.goals.progress} className="space-y-2.5">
        {topGoals(goals, MINI_LIMIT).map((status) => {
          const run = streakText(status.streak, status.goal.period, t);
          return (
            <li key={status.goal.id}>
              <p className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate" title={status.goal.label}>
                  {status.goal.label}
                </span>
                <span className="tabular shrink-0 text-xs text-muted-foreground">
                  {status.unseen ? unseenLabel(status.unseen, t) : run ? t.goals.inARow(status.streak.current) : ""}
                </span>
              </p>
              <GoalBar status={status} className="mt-0.5" />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
