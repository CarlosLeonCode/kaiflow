import { useT } from "@/shared/i18n";
import { cn } from "@/shared/lib/utils";

import { fraction } from "../lib/progress";
import { DailyEnso } from "./DailyEnso";

interface Props {
  /** Today's strokes. */
  strokes: number;
  /** Strokes a day holds. */
  cap: number;
  /** The daily ensō is full: the chip turns mint and reads "Done today". */
  done: boolean;
  /** Opens Goals; without it the chip is plain text. */
  onClick?: () => void;
  className?: string;
}

const CHIP =
  "inline-flex h-[30px] items-center gap-1.5 rounded-full border-2 border-mark-stroke pr-3 pl-[5px] font-display text-sm leading-none font-bold text-on-pop tabular-nums shadow-(--shadow-sticker)";

/** A yellow sticker pill beside the day's total: a tiny ensō and today's strokes. */
export function StrokesChip({ strokes, cap, done, onClick, className }: Props) {
  const t = useT();
  const content = (
    <>
      <DailyEnso progress={done ? 1 : fraction(strokes, cap)} label="" size={18} weight={16} onPop />
      {done ? t.progress.chip.done : t.progress.chip.earned(strokes)}
      <span className="font-semibold text-on-pop-muted">{t.progress.chip.today}</span>
    </>
  );
  const classes = cn(CHIP, done ? "bg-pop-mint" : "bg-pop-sun", className);
  if (!onClick) {
    return (
      <span className={classes} data-state={done ? "done" : "earning"}>
        {content}
      </span>
    );
  }
  const summary = done ? t.progress.enso.done : t.progress.enso.label(strokes, cap);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t.progress.chip.open(summary)}
      data-state={done ? "done" : "earning"}
      className={cn(classes, "focus-visible:outline-offset-3")}
    >
      {content}
    </button>
  );
}
