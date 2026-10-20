import { formatDuration } from "@/shared/lib/time";
import { Skeleton } from "@/shared/ui/skeleton";

import type { TopAppRow } from "../lib/derive";

interface Props {
  rows: TopAppRow[];
  loading: boolean;
}

export function TopApps({ rows, loading }: Props) {
  return (
    <section aria-label="Top apps today" className="px-4">
      <h2 className="mb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        Top apps
      </h2>
      {loading ? (
        <div className="space-y-2 py-1" aria-label="Loading top apps">
          <Skeleton className="h-6" />
          <Skeleton className="h-6" />
          <Skeleton className="h-6" />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-2 text-muted-foreground">No activity recorded yet today.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.key} className="grid grid-cols-[20px_1fr_auto] items-center gap-x-2 py-1.5">
              <span
                aria-hidden="true"
                className="flex size-5 items-center justify-center rounded-sm bg-muted text-2xs font-medium text-muted-foreground"
              >
                {Array.from(row.name)[0]?.toUpperCase() ?? "?"}
              </span>
              <div className="min-w-0">
                <p className="truncate" title={row.name}>
                  {row.name}
                </p>
                <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${Math.max(2, Math.round(row.share * 100))}%` }}
                  />
                </div>
              </div>
              <span className="tabular text-xs text-muted-foreground">{formatDuration(row.totalMs)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
