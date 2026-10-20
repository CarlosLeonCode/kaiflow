import { ArrowDownRight, ArrowUpRight, Equal } from "lucide-react";

import { formatDuration } from "@/shared/lib/time";

import { previousLabel, type Period } from "../lib/periods";
import type { Averages, Bar, Comparison } from "../lib/summary";

interface Props {
  period: Period;
  totalMs: number;
  comparison: Comparison;
  averages: Averages;
  busiest: Bar | null;
}

function comparisonText(period: Period, c: Comparison): string {
  const against = previousLabel(period);
  if (c.direction === "same") return c.pct === null ? `Nothing tracked in ${against} either` : `Same as ${against}`;
  const amount = formatDuration(Math.abs(c.deltaMs));
  if (c.pct === null) return `${amount} more than ${against}, when nothing was tracked`;
  const sign = c.direction === "up" ? "more" : "less";
  return `${amount} ${sign} than ${against} (${c.pct > 0 ? "+" : ""}${c.pct}%)`;
}

/** Total focused time, the change against the previous period and a couple of quick stats. */
export function PeriodSummary({ period, totalMs, comparison, averages, busiest }: Props) {
  const Icon = comparison.direction === "up" ? ArrowUpRight : comparison.direction === "down" ? ArrowDownRight : Equal;
  const unit = period === "day" ? "hour" : "day";
  return (
    <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
      <div>
        <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">Focused time</p>
        <p
          data-testid="history-total"
          className="tabular text-display font-semibold tracking-tight"
          aria-label={`Focused time ${formatDuration(totalMs)}`}
        >
          {formatDuration(totalMs)}
        </p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="history-comparison">
          <Icon className="size-3.5" aria-hidden="true" />
          {comparisonText(period, comparison)}
        </p>
      </div>
      <dl className="flex gap-8 pb-0.5">
        {period !== "day" && (
          <div>
            <dt className="text-xs text-muted-foreground">Per active day</dt>
            <dd className="tabular font-medium">
              {averages.activeDays > 0 ? formatDuration(averages.perActiveDayMs) : "—"}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-muted-foreground">Busiest {unit}</dt>
          <dd className="font-medium">{busiest ? busiest.fullLabel : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Active {unit}s</dt>
          <dd className="tabular font-medium">{averages.activeDays}</dd>
        </div>
      </dl>
    </div>
  );
}
