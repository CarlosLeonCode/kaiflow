import { useState } from "react";

import type { RangeDto } from "@/shared/ipc";
import { tuneCategoryColor } from "@/shared/lib/color";
import { formatDuration } from "@/shared/lib/time";

import { axisTicks, type TimelineBlock } from "../lib/today";

const WIDTH = 1000;
const HEIGHT = 36;

interface Props {
  window: RangeDto;
  blocks: readonly TimelineBlock[];
  now: number;
  dark: boolean;
}

function hourLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric" });
}

/**
 * Hand-rolled SVG of the day: one block per segment colored by category, hour ticks, and a
 * marker for now. The svg is an image for assistive tech (the lists below carry the same
 * data as text); pointer users get a native tooltip and a readout line.
 */
export function DayTimeline({ window, blocks, now, dark }: Props) {
  const [active, setActive] = useState<TimelineBlock | null>(null);
  const ticks = axisTicks(window);
  const span = window.to - window.from;
  const nowX = now >= window.from && now <= window.to ? ((now - window.from) / span) * WIDTH : null;
  const first = blocks[0];
  const summary =
    blocks.length === 0
      ? "Timeline of today: no activity"
      : `Timeline of today: ${blocks.length} ${blocks.length === 1 ? "block" : "blocks"}, colored by category. The same data is listed below by app and category.`;

  return (
    <div>
      <svg
        role="img"
        aria-label={summary}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="block h-9 w-full overflow-visible"
      >
        <rect x={0} y={0} width={WIDTH} height={HEIGHT} rx={4} style={{ fill: "var(--muted)" }} />
        {ticks.map((tick) => (
          <line
            key={tick.at}
            x1={(tick.pct / 100) * WIDTH}
            x2={(tick.pct / 100) * WIDTH}
            y1={0}
            y2={HEIGHT}
            vectorEffect="non-scaling-stroke"
            style={{ stroke: "var(--border)", strokeWidth: 1 }}
          />
        ))}
        {blocks.map((block) => (
          <rect
            key={block.id}
            x={(block.leftPct / 100) * WIDTH}
            y={3}
            width={Math.max((block.widthPct / 100) * WIDTH, 2)}
            height={HEIGHT - 6}
            vectorEffect="non-scaling-stroke"
            onPointerEnter={() => setActive(block)}
            onPointerLeave={() => setActive((current) => (current?.id === block.id ? null : current))}
            style={{
              fill: tuneCategoryColor(block.color, dark),
              stroke: "var(--background)",
              strokeWidth: 1,
            }}
          >
            <title>{`${block.label}, ${formatDuration(block.durationMs)}`}</title>
          </rect>
        ))}
        {nowX !== null && (
          <line
            x1={nowX}
            x2={nowX}
            y1={0}
            y2={HEIGHT}
            vectorEffect="non-scaling-stroke"
            style={{ stroke: "var(--foreground)", strokeWidth: 1.5 }}
          />
        )}
      </svg>

      <div className="relative mt-1 h-4" aria-hidden="true">
        {ticks.map((tick, index) => (
          <span
            key={tick.at}
            className="tabular absolute -translate-x-1/2 text-2xs text-muted-foreground"
            style={{
              left: `${tick.pct}%`,
              ...(index === 0 ? { transform: "none" } : {}),
              ...(index === ticks.length - 1 && tick.pct > 96 ? { transform: "translateX(-100%)" } : {}),
            }}
          >
            {hourLabel(tick.at)}
          </span>
        ))}
      </div>

      <p className="mt-2 h-4 truncate text-xs text-muted-foreground" aria-hidden="true">
        {active ? (
          <>
            <span className="font-medium text-foreground">{active.label}</span>
            <span className="tabular"> · {formatDuration(active.durationMs)}</span>
          </>
        ) : first ? (
          "Hover a block for details."
        ) : (
          ""
        )}
      </p>
    </div>
  );
}
