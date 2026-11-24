import { useT } from "@/shared/i18n";
import { cn } from "@/shared/lib/utils";

interface Props {
  /** Whether each of the last seven days holds strokes, oldest first, ending today. */
  last7: readonly boolean[];
  current: number;
  best: number;
  /** Weekday initials of the same days, from the locale (`weekdayInitials`). */
  weekdays: readonly string[];
  className?: string;
}

const DOT = "box-border size-4 rounded-full border-2";

/** The last seven days as fat dots, plus the streak in words. A missed day is a dashed ring. */
export function StreakDots({ last7, current, best, weekdays, className }: Props) {
  const t = useT();
  const today = last7.length - 1;
  const met = last7.filter(Boolean).length;
  return (
    <div className={cn("grid justify-items-start gap-3", className)}>
      <div
        role="img"
        aria-label={t.progress.streak.summary(met, last7.length)}
        className="inline-grid grid-cols-[repeat(7,22px)] justify-items-center gap-x-1.5 gap-y-1.5 text-2xs font-semibold text-muted-foreground"
      >
        {last7.map((on, i) => (
          <i
            key={`dot-${i}`}
            data-state={i === today ? (on ? "today-met" : "today-open") : on ? "met" : "missed"}
            className={cn(
              DOT,
              i === today
                ? on
                  ? "border-mark-stroke bg-now-dot"
                  : "border-now-dot"
                : on
                  ? "border-mark-stroke bg-pop-mint"
                  : "border-dashed border-seal-locked",
            )}
          />
        ))}
        {last7.map((_, i) => (
          <span key={`day-${i}`}>{weekdays[i] ?? ""}</span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        <b className="font-display text-lg leading-none font-extrabold text-foreground">
          {current > 0 ? t.progress.streak.current(current) : t.progress.streak.none}
        </b>
        {best > 0 && ` · ${t.progress.streak.best(best)}`}
      </p>
    </div>
  );
}
