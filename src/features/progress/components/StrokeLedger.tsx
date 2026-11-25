import type { StrokeEntryDto } from "@/shared/ipc";
import { useT } from "@/shared/i18n";
import { cn } from "@/shared/lib/utils";

import { ledgerRows } from "../lib/progress";

interface Props {
  /** Today's entries, oldest first. */
  entries: readonly StrokeEntryDto[];
  /** Today's strokes. */
  total: number;
  /** The daily ensō is full: the list ends with "Done for today". */
  done: boolean;
  className?: string;
}

const ROW = "grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-border py-2 last:border-b-0";
const PILL =
  "min-w-[3.4ch] rounded-full px-2 py-[3px] text-center font-display text-xs leading-[1.2] font-bold text-on-pop tabular-nums";

/** How today's strokes were earned, so the number never feels random. */
export function StrokeLedger({ entries, total, done, className }: Props) {
  const t = useT();
  const rows = ledgerRows(entries);
  if (rows.length === 0) {
    return <p className={cn("text-xs text-muted-foreground", className)}>{t.progress.ledger.empty}</p>;
  }
  return (
    <ul aria-label={t.progress.ledger.label} className={cn("m-0 list-none p-0 text-sm text-foreground", className)}>
      {rows.map((row) => (
        <li key={row.source} className={ROW}>
          <span>{t.progress.sources[row.source]}</span>
          <span className="text-muted-foreground tabular-nums">{t.progress.ledger.count(row.count)}</span>
          <span className={cn(PILL, "bg-pop-mint")}>{t.progress.ledger.strokes(row.strokes)}</span>
        </li>
      ))}
      <li className={cn(ROW, "pt-3 font-display text-lg leading-[1.2] font-bold")}>
        <span>{t.progress.ledger.total}</span>
        <span />
        <span className={cn(PILL, "bg-pop-sun text-lg")}>{total}</span>
      </li>
      {done && (
        <li className={cn(ROW, "text-muted-foreground")}>
          <span>{t.progress.ledger.done}</span>
        </li>
      )}
    </ul>
  );
}
