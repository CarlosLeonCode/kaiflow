import type { ProgressLevelDto } from "@/shared/ipc";
import { useLocale, useT } from "@/shared/i18n";
import { cn } from "@/shared/lib/utils";

import { LEVEL_PATH_HEIGHT, LEVEL_PATH_WIDTH, levelPathShape } from "../lib/enso";
import { fraction } from "../lib/progress";

interface Props {
  level: ProgressLevelDto;
  className?: string;
}

/** Where you are on the path: the level number, its name and the distance to the next one. */
export function LevelPath({ level, className }: Props) {
  const t = useT();
  const number = new Intl.NumberFormat(useLocale());
  const name = t.progress.levels[level.name];
  const atTop = level.span === null || level.next_name === null;
  const line = atTop
    ? t.progress.level.top(number.format(level.total))
    : t.progress.level.toNext(
        number.format(level.into_level),
        number.format(level.span ?? 0),
        t.progress.levels[level.next_name ?? level.name],
      );
  const shape = levelPathShape(atTop ? 1 : fraction(level.into_level, level.span ?? 0));
  return (
    <div className={cn("grid gap-2 text-foreground", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <span className="flex items-baseline gap-2 font-display text-[18px] leading-[1.2] font-bold">
          <b className="font-display text-[40px] leading-none font-extrabold tracking-[-0.03em] tabular-nums">
            {level.number}
          </b>
          {name}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">{line}</span>
      </div>
      <svg
        viewBox={`0 0 ${LEVEL_PATH_WIDTH} ${LEVEL_PATH_HEIGHT}`}
        className="block h-auto w-full"
        role="img"
        aria-label={`${t.progress.level.label(level.number, name)}: ${line}`}
        focusable="false"
      >
        <rect {...shape.track} className="fill-enso-track" />
        {shape.ink && <path d={shape.ink} data-part="ink" className="fill-enso-stroke" />}
        <circle cx={shape.dot.cx} cy={shape.dot.cy} r={shape.dot.r} className="fill-now-dot" />
      </svg>
    </div>
  );
}
