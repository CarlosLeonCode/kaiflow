import { type CSSProperties, useState } from "react";

import type { RangeDto } from "@/shared/ipc";
import { tuneActivityColor } from "@/shared/lib/color";
import { formatDuration, formatHour } from "@/shared/lib/time";

import { axisTicks, type TimelineBlock } from "../lib/today";

const WIDTH = 1000;
const HEIGHT = 36;

interface Props {
  window: RangeDto;
  blocks: readonly TimelineBlock[];
  now: number;
  dark: boolean;
}

/** Ticks closer than this (in %) to an edge are anchored to it instead of centered. */
const EDGE_PCT = 4;

/**
 * Edge ticks are anchored with `left: 0` / `right: 0` instead of a centered `left: pct%`:
 * an absolutely positioned label near the right edge gets only the remaining width as its
 * shrink-to-fit width (a translate does not change layout), so it wrapped ("4 / AM").
 */
function tickPosition(pct: number): CSSProperties {
  if (pct <= EDGE_PCT) return { left: 0 };
  if (pct >= 100 - EDGE_PCT) return { right: 0 };
  return { left: `${pct}%`, transform: "translateX(-50%)" };
}

/**
 * Hand-rolled SVG of the day: one block per segment colored by activity, hour ticks, and a
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
      : `Timeline of today: ${blocks.length} ${blocks.length === 1 ? "block" : "blocks"}, colored by activity. The same data is listed below by app and activity.`;

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
              fill: tuneActivityColor(block.color, dark),
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

      <div className="relative mt-1 h-4" aria-hidden="true" data-testid="timeline-axis">
        {ticks.map((tick) => (
          <span
            key={tick.at}
            className="tabular absolute top-0 whitespace-nowrap text-2xs text-muted-foreground"
            style={tickPosition(tick.pct)}
          >
            {formatHour(tick.at)}
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
