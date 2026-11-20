import { useT } from "@/shared/i18n";
import { formatClock } from "@/shared/lib/time";

export function TodayTotal({ totalMs, live }: { totalMs: number | undefined; live: boolean }) {
  const today = useT().shell.sections.today;
  return (
    <section aria-label={today} className="px-4 pt-4 pb-3">
      <p className="text-xs font-medium text-muted-foreground">{today}</p>
      <p
        className="tabular text-display font-semibold tracking-tight"
        aria-live="off"
        data-testid="today-total"
        data-live={live}
      >
        {totalMs === undefined ? "–:––:––" : formatClock(totalMs)}
      </p>
    </section>
  );
}
