import { ArrowRight } from "lucide-react";

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
  if (!goals) return null;
  return (
    <section aria-label="Goals" className="rounded-lg border border-border bg-background p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">Goals</h2>
        {goals.length > 0 && (
          <Button variant="ghost" size="sm" onClick={onOpenGoals}>
            All goals <ArrowRight aria-hidden="true" />
          </Button>
        )}
      </div>
      {goals.length === 0 ? (
        <EmptyState className="mt-0 py-3" title="No goals yet" action={{ label: "Create a goal", onClick: onCreate }}>
          A goal turns your time into a target, like at least 4 hours of focused work a day or at most 30 minutes in
          email.
        </EmptyState>
      ) : (
        <ul aria-label="Goal progress" className="divide-y divide-border">
          {topGoals(goals, STRIP_LIMIT).map((status) => (
            <GoalSummary key={status.goal.id} status={status} onMarkSeen={onMarkSeen} />
          ))}
        </ul>
      )}
    </section>
  );
}
