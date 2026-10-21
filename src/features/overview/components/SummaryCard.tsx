import { ArrowDownRight, ArrowUpRight, Equal, Minus } from "lucide-react";

import { formatDuration } from "@/shared/lib/time";

import type { Period } from "../lib/periods";
import type { Averages, TrendView } from "../lib/summary";

interface Props {
  period: Period;
  totalMs: number;
  trend: TrendView;
  averages: Averages;
  /** Long name of the busiest bar, or `null` when nothing was tracked. */
  busiest: string | null;
  /** Noun of one bar: hour, day or week. */
  bucket: { singular: string; plural: string };
}

const ICONS = { up: ArrowUpRight, down: ArrowDownRight, same: Equal, none: Minus } as const;

/** Total tracked time, how it compares with the period before and a few quick statistics. */
export function SummaryCard({ period, totalMs, trend, averages, busiest, bucket }: Props) {
  const Icon = ICONS[trend.direction];
  return (
    <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
      <div className="min-w-0">
        <p
          data-testid="overview-total"
          className="tabular text-display font-semibold tracking-tight"
          aria-label={`Tracked time ${formatDuration(totalMs)}`}
        >
          {formatDuration(totalMs)}
        </p>
        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground" data-testid="overview-comparison">
          <Icon className="size-3.5 shrink-0" aria-hidden="true" />
          {trend.text}
        </p>
      </div>
      <dl className="flex gap-8 pb-0.5">
        {period !== "day" && (
          <div>
            <dt className="text-xs text-muted-foreground">Per active {bucket.singular}</dt>
            <dd className="tabular font-medium">
              {averages.activeBuckets > 0 ? formatDuration(averages.perActiveBucketMs) : "—"}
            </dd>
          </div>
        )}
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Busiest {bucket.singular}</dt>
          <dd className="truncate font-medium">{busiest ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Active {bucket.plural}</dt>
          <dd className="tabular font-medium">{averages.activeBuckets}</dd>
        </div>
      </dl>
    </div>
  );
}
