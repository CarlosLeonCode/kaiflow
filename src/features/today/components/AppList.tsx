import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { formatDuration } from "@/shared/lib/time";
import { NO_TITLE_LABEL } from "@/shared/lib/labels";
import { cn } from "@/shared/lib/utils";

import type { AppRow } from "../lib/today";

const MAX_TITLES = 12;

/** Totals by app; each row expands to the window titles seen in that app (React escapes them). */
export function AppList({ rows }: { rows: readonly AppRow[] }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <ul className="divide-y divide-border" aria-label="Time by app">
      {rows.map((row) => {
        const expanded = open.has(row.key);
        const panelId = `titles-${row.key}`;
        const shown = row.titles.slice(0, MAX_TITLES);
        const hidden = row.titles.length - shown.length;
        return (
          <li key={row.key}>
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => toggle(row.key)}
              className="group flex w-full items-center gap-2 rounded-md px-1 py-2 text-left hover:bg-accent"
            >
              <ChevronRight
                aria-hidden="true"
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-transform",
                  expanded && "rotate-90",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate" title={row.name}>
                  {row.name}
                </span>
                <span aria-hidden="true" className="mt-1 block h-0.5 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-primary/70"
                    style={{ width: `${Math.max(2, Math.round(row.share * 100))}%` }}
                  />
                </span>
              </span>
              <span className="tabular w-16 shrink-0 text-right text-xs text-muted-foreground">
                {formatDuration(row.totalMs)}
              </span>
            </button>
            {expanded && (
              <ul id={panelId} data-selectable aria-label={`Window titles in ${row.name}`} className="mb-2 ml-6 space-y-0.5 border-l border-border pl-3">
                {shown.length === 0 && (
                  <li className="py-0.5 text-xs text-muted-foreground">No window titles recorded.</li>
                )}
                {shown.map((entry) => (
                  <li key={entry.title ?? "∅"} className="flex items-baseline justify-between gap-3 py-0.5 text-xs">
                    <span className={cn("min-w-0 truncate", entry.title === null && "text-muted-foreground")} title={entry.title ?? undefined}>
                      {entry.title ?? NO_TITLE_LABEL}
                    </span>
                    <span className="tabular shrink-0 text-muted-foreground">{formatDuration(entry.totalMs)}</span>
                  </li>
                ))}
                {hidden > 0 && (
                  <li className="py-0.5 text-xs text-muted-foreground">and {hidden} more</li>
                )}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
