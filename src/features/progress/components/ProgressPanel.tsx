import { useEffect, useId, useRef, type RefObject } from "react";

import type { MomentDto, ProgressDto } from "@/shared/ipc";
import { useT } from "@/shared/i18n";
import { cn } from "@/shared/lib/utils";

import { fraction } from "../lib/progress";
import { DailyEnso } from "./DailyEnso";
import { LevelPath } from "./LevelPath";
import { ProgressMoment } from "./ProgressMoment";
import { SealGrid } from "./SealGrid";
import { StreakDots } from "./StreakDots";
import { StrokeLedger } from "./StrokeLedger";

interface Props {
  progress: ProgressDto;
  /** Weekday initials of the last seven days, oldest first, from the locale. */
  weekdays: readonly string[];
  onDismissMoment: (moment: MomentDto) => void;
  /** Changes to a positive number when the panel should scroll into view (opened for it). */
  reveal?: number;
  className?: string;
}

const HEADING = "font-display text-sm leading-[1.2] font-bold text-foreground";

/** Where a moment's link lands inside the panel. */
function targetOf(moment: MomentDto): "today" | "level" | "seals" {
  switch (moment.kind) {
    case "day_done":
      return "today";
    case "level":
      return "level";
    case "seal":
      return "seals";
  }
}

/**
 * The Progress panel on Goals (presentational): today's ensō with the level path, the streak,
 * how today's strokes were earned and the seals. The moment card, when there is one, sits on
 * top; its link scrolls to the part it is about.
 */
export function ProgressPanel({ progress, weekdays, onDismissMoment, reveal = 0, className }: Props) {
  const t = useT();
  const m = t.progress;
  const titleId = useId();
  const todayRef = useRef<HTMLDivElement>(null);
  const levelRef = useRef<HTMLDivElement>(null);
  const sealsRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const { today, level, streak, seals, moment } = progress;

  useEffect(() => {
    if (reveal > 0) panelRef.current?.scrollIntoView({ block: "start" });
  }, [reveal]);
  const ensoLabel = today.done ? m.enso.done : today.strokes === 0 ? m.enso.empty : m.enso.label(today.strokes, today.cap);

  const open = (target: MomentDto) => {
    const refs: Record<ReturnType<typeof targetOf>, RefObject<HTMLDivElement | null>> = {
      today: todayRef,
      level: levelRef,
      seals: sealsRef,
    };
    const node = refs[targetOf(target)].current;
    node?.scrollIntoView({ behavior: "smooth", block: "start" });
    node?.focus({ preventScroll: true });
  };

  return (
    <section
      ref={panelRef}
      aria-labelledby={titleId}
      className={cn("scroll-mt-4 space-y-6 rounded-card bg-paper-surface p-5 text-foreground", className)}
    >
      <h2 id={titleId} className="font-display text-lg leading-[1.2] font-bold">
        {m.panel.title}
      </h2>

      {moment && (
        <ProgressMoment moment={moment} seals={seals} onOpen={open} onDismiss={onDismissMoment} />
      )}

      <div ref={levelRef} tabIndex={-1} className="flex items-center gap-5 outline-none">
        <DailyEnso progress={today.done ? 1 : fraction(today.strokes, today.cap)} label={ensoLabel} size={96} animate />
        <LevelPath level={level} className="min-w-0 flex-1" />
      </div>

      <div className="grid gap-6 sm:grid-cols-[auto_1fr]">
        <div className="space-y-3">
          <h3 className={HEADING}>{m.panel.streak}</h3>
          <StreakDots last7={streak.last7} current={streak.current} best={streak.best} weekdays={weekdays} />
        </div>
        <div ref={todayRef} tabIndex={-1} className="min-w-0 space-y-1 outline-none">
          <h3 className={HEADING}>{m.panel.today}</h3>
          <StrokeLedger entries={today.entries} total={today.strokes} done={today.done} />
        </div>
      </div>

      <div ref={sealsRef} tabIndex={-1} className="space-y-4 outline-none">
        <h3 className={HEADING}>{m.panel.seals}</h3>
        <SealGrid seals={seals} />
      </div>
    </section>
  );
}
