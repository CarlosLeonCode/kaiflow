import { ArrowRight } from "lucide-react";

import { useT } from "@/shared/i18n";
import type { GoalStatusDto } from "@/shared/ipc";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/EmptyState";

import { topGoals } from "../lib/goals";
import { GoalSummary } from "./GoalSummary";

/** Goals shown on Today; the rest live in the Goals section. */
const STRIP_LIMIT = 4;

interface Props {
  /** `undefined` while the first load is pending. */
  goals: readonly GoalStatusDto[] | undefined;
  onCreate: () => void;
  onOpenGoals: () => void;
  onMarkSeen: (goalId: number) => void;
}

/**
 * Today's goals (presentational): progress bars with streaks, or an invitation to create the
 * first goal when there are none.
 */
export function GoalsStrip({ goals, onCreate, onOpenGoals, onMarkSeen }: Props) {
  const t = useT();
  if (!goals) return null;
  return (
    <section aria-label={t.shell.sections.goals} className="rounded-card border border-border bg-background p-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="font-display text-sm leading-[1.2] font-bold text-foreground">{t.shell.sections.goals}</h2>
        {goals.length > 0 && (
          <Button variant="ghost" size="sm" onClick={onOpenGoals}>
            {t.goals.allGoals} <ArrowRight aria-hidden="true" />
          </Button>
        )}
      </div>
      {goals.length === 0 ? (
        <EmptyState className="mt-0 py-3" title={t.goals.noGoals} action={{ label: t.goals.createGoal, onClick: onCreate }}>
          {t.goals.emptyStrip}
        </EmptyState>
      ) : (
        <ul aria-label={t.goals.progress} className="divide-y divide-border">
          {topGoals(goals, STRIP_LIMIT).map((status) => (
            <GoalSummary key={status.goal.id} status={status} onMarkSeen={onMarkSeen} />
          ))}
        </ul>
      )}
    </section>
  );
}
