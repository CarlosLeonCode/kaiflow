import { tuneCategoryColor } from "@/shared/lib/color";
import { formatDuration } from "@/shared/lib/time";

import { formatPercent } from "@/features/today/lib/today";

import type { Row } from "../lib/summary";

interface Props {
  rows: readonly Row[];
  label: string;
  dark: boolean;
  empty: string;
}

/** Totals for the period by category (colored) or by app (accent bar), with the share of the total. */
export function BreakdownList({ rows, label, dark, empty }: Props) {
  if (rows.length === 0) return <p className="py-3 text-xs text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y divide-border" aria-label={label}>
      {rows.map((row) => {
        const color = row.color ? tuneCategoryColor(row.color, dark) : null;
        return (
          <li key={row.key} className="px-1 py-2">
            <div className="flex items-center gap-2">
              {color && (
                <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
              )}
              <span className="min-w-0 flex-1 truncate" title={row.name}>
                {row.name}
              </span>
              <span className="tabular text-xs text-muted-foreground">{formatDuration(row.totalMs)}</span>
              <span className="tabular w-9 text-right text-xs text-muted-foreground">{formatPercent(row.fraction)}</span>
            </div>
            <div aria-hidden="true" className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-muted">
              <div
                className={color ? "h-full rounded-full" : "h-full rounded-full bg-primary/70"}
                style={{
                  width: `${Math.max(2, Math.round(row.fraction * 100))}%`,
                  ...(color ? { backgroundColor: color } : {}),
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
