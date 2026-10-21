import type { GoalStatusDto } from "@/shared/ipc";
import { cn } from "@/shared/lib/utils";

import { barPercent, formatAmount, remainingText, stateLabel, type Tone } from "../lib/goals";

const FILL: Record<Tone, string> = {
  neutral: "bg-primary",
  good: "bg-success",
  warning: "bg-warning-foreground",
};

const DOT: Record<Tone, string> = {
  neutral: "bg-muted-foreground/50",
  good: "bg-success",
  warning: "bg-warning-foreground",
};

/** Colored dot plus the state in words: color is never the only signal. */
export function StateBadge({ status }: { status: GoalStatusDto }) {
  const state = stateLabel(status);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOT[state.tone])} />
      {state.label}
    </span>
  );
}

/**
 * Progress of one goal: the bar (a progressbar with its numbers in the label), `4h of 6h` and
 * what is left. A bar that passed 100 % stays full; the text says by how much.
 */
export function GoalBar({ status, className }: { status: GoalStatusDto; className?: string }) {
  const state = stateLabel(status);
  const label = `${status.goal.label}: ${formatAmount(status.actual_ms)} of ${formatAmount(status.target_ms)}, ${state.label.toLowerCase()}`;
  return (
    <div className={className}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={barPercent(status)}
        aria-valuetext={`${status.percent}%`}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full transition-[width]", FILL[state.tone])}
          style={{ width: `${Math.max(status.actual_ms > 0 ? 2 : 0, barPercent(status))}%` }}
        />
      </div>
      <p className="tabular mt-1 flex justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {formatAmount(status.actual_ms)} of {formatAmount(status.target_ms)}
        </span>
        <span>{status.active ? remainingText(status) : "Not counted today"}</span>
      </p>
    </div>
  );
}
