import { useT } from "@/shared/i18n";
import type { GoalStatusDto } from "@/shared/ipc";
import { cn } from "@/shared/lib/utils";

import { barPercent, formatAmount, remainingText, stateLabel, type Tone } from "../lib/goals";

const FILL: Record<Tone, string> = {
  neutral: "bg-mark-stroke",
  good: "bg-pop-mint",
  warning: "bg-pop-pink",
};

const DOT: Record<Tone, string> = {
  neutral: "bg-muted-foreground/50",
  good: "bg-pop-mint",
  warning: "bg-pop-pink",
};

/** Colored dot plus the state in words: color is never the only signal. */
export function StateBadge({ status }: { status: GoalStatusDto }) {
  const state = stateLabel(status, useT());
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span aria-hidden="true" className={cn("size-2 rounded-full", DOT[state.tone])} />
      {state.label}
    </span>
  );
}

/**
 * Progress of one goal: the bar (a progressbar with its numbers in the label), `4h of 6h` and
 * what is left. A bar that passed 100 % stays full; the text says by how much.
 */
export function GoalBar({ status, className }: { status: GoalStatusDto; className?: string }) {
  const t = useT();
  const state = stateLabel(status, t);
  const actual = formatAmount(status.actual_ms);
  const target = formatAmount(status.target_ms);
  const label = t.goals.barLabel(status.goal.label, actual, target, state.label);
  return (
    <div className={className}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={barPercent(status)}
        aria-valuetext={`${status.percent}%`}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full transition-[width]", FILL[state.tone])}
          style={{ width: `${Math.max(status.actual_ms > 0 ? 2 : 0, barPercent(status))}%` }}
        />
      </div>
      <p className="tabular mt-1 flex justify-between gap-2 text-xs text-muted-foreground">
        <span>{t.goals.amountOf(actual, target)}</span>
        <span>{status.active ? remainingText(status, t) : t.goals.notCountedToday}</span>
      </p>
    </div>
  );
}
