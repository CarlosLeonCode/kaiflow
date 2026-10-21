import { Check } from "lucide-react";

import type { GoalStatusDto } from "@/shared/ipc";
import { Button } from "@/shared/ui/button";

import { bestStreakText, streakText, unseenLabel } from "../lib/goals";
import { GoalBar, StateBadge } from "./GoalBar";

interface Props {
  status: GoalStatusDto;
  /** Acknowledges the badge of a crossing. Omit where the badge is not actionable. */
  onMarkSeen?: (goalId: number) => void;
}

/** Streak line: the current run, flagged when today could still end it. */
export function StreakLine({ status }: { status: GoalStatusDto }) {
  const { streak, goal } = status;
  const run = streakText(streak, goal.period);
  const best = bestStreakText(streak, goal.period);
  if (!run && !best) return null;
  return (
    <span className="text-xs text-muted-foreground">
      {run ? `Streak: ${run}` : best}
      {run && streak.at_risk && status.active && (
        <span className="ml-1.5 text-warning-foreground">At risk this {goal.period === "daily" ? "day" : goal.period === "weekly" ? "week" : "month"}</span>
      )}
    </span>
  );
}

/** One goal in a compact list: name, state, the unseen badge, the bar and the streak. */
export function GoalSummary({ status, onMarkSeen }: Props) {
  const { goal, unseen } = status;
  return (
    <li className="space-y-1 py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate font-medium" title={goal.label}>
          {goal.label}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {unseen && (
            <span
              data-testid="goal-badge"
              className="inline-flex items-center gap-1 rounded-full bg-warning px-2 py-0.5 text-2xs font-medium text-warning-foreground"
            >
              {unseenLabel(unseen)}
              {onMarkSeen && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-4"
                  aria-label={`Dismiss the alert for ${goal.label}`}
                  onClick={() => onMarkSeen(goal.id)}
                >
                  <Check className="!size-3" />
                </Button>
              )}
            </span>
          )}
          <StateBadge status={status} />
        </span>
      </div>
      <GoalBar status={status} />
      <StreakLine status={status} />
    </li>
  );
}
