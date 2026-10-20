import { tuneCategoryColor } from "@/shared/lib/color";
import { formatDuration } from "@/shared/lib/time";

import { formatPercent, type CategoryRow } from "../lib/today";

/** Totals by category with a share bar in the category color (tuned for the theme). */
export function CategoryList({ rows, dark }: { rows: readonly CategoryRow[]; dark: boolean }) {
  return (
    <ul className="divide-y divide-border" aria-label="Time by category">
      {rows.map((row) => {
        const color = tuneCategoryColor(row.color, dark);
        return (
          <li key={row.id} className="px-1 py-2">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
              <span className="min-w-0 flex-1 truncate" title={row.name}>
                {row.name}
              </span>
              <span className="tabular text-xs text-muted-foreground">{formatDuration(row.totalMs)}</span>
              <span className="tabular w-9 text-right text-xs text-muted-foreground">{formatPercent(row.fraction)}</span>
            </div>
            <div aria-hidden="true" className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.max(2, Math.round(row.fraction * 100))}%`, backgroundColor: color }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
