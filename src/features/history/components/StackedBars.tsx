import { useEffect, useRef, useState } from "react";

import { tuneCategoryColor } from "@/shared/lib/color";
import { formatAxisDuration, formatDuration } from "@/shared/lib/time";

import { niceCeiling, type Bar } from "../lib/summary";

const WIDTH = 1000;
const HEIGHT = 160;
const MAX_BAR = 56;

interface Props {
  bars: readonly Bar[];
  dark: boolean;
  /** Describes the chart for assistive tech, e.g. "Focused time per day". */
  label: string;
}

/** Axis labels shown for every Nth bar so 24 hours or 31 days never collide. */
function labelStep(count: number): number {
  if (count <= 8) return 1;
  if (count <= 26) return 3;
  return 5;
}

function barLabel(bar: Bar): string {
  if (bar.totalMs === 0) return `${bar.fullLabel}: nothing tracked`;
  const parts = bar.segments
    .slice(0, 4)
    .map((segment) => `${segment.name} ${formatDuration(segment.ms)}`)
    .join(", ");
  return `${bar.fullLabel}: ${formatDuration(bar.totalMs)}. ${parts}`;
}

/**
 * Hand-rolled SVG stacked bars (one per day or hour, stacked by category, colors tuned for
 * the theme). Every bar is a focusable image with a spoken summary; arrow keys move between
 * bars (roving tab stop) and the readout under the chart follows hover and focus.
 */
export function StackedBars({ bars, dark, label }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const refs = useRef<(SVGGElement | null)[]>([]);
  const wantFocus = useRef(false);

  const ceiling = niceCeiling(Math.max(0, ...bars.map((bar) => bar.totalMs)));
  const slot = WIDTH / Math.max(bars.length, 1);
  const barWidth = Math.min(MAX_BAR, slot * 0.64);
  const step = labelStep(bars.length);
  const firstWithData = bars.findIndex((bar) => bar.totalMs > 0);
  const tabStop = focused ?? (firstWithData >= 0 ? firstWithData : 0);
  const readout = active === null ? null : (bars[active] ?? null);

  useEffect(() => {
    if (wantFocus.current && focused !== null) {
      refs.current[focused]?.focus();
      wantFocus.current = false;
    }
  }, [focused]);

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const last = bars.length - 1;
    const target =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? Math.min(index + 1, last)
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? Math.max(index - 1, 0)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    wantFocus.current = true;
    setFocused(target);
    setActive(target);
  }

  return (
    <div>
      <div className="flex gap-2">
        <div
          aria-hidden="true"
          data-testid="history-y-axis"
          className="tabular flex h-40 w-12 shrink-0 flex-col justify-between whitespace-nowrap text-right text-2xs text-muted-foreground"
        >
          <span className="-mt-1">{formatAxisDuration(ceiling)}</span>
          <span>{formatAxisDuration(ceiling / 2)}</span>
          <span className="-mb-1">0</span>
        </div>
        <svg
          role="group"
          aria-label={label}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="block h-40 min-w-0 flex-1 overflow-visible"
        >
          {[0, 0.5, 1].map((fraction) => (
            <line
              key={fraction}
              x1={0}
              x2={WIDTH}
              y1={HEIGHT - fraction * HEIGHT}
              y2={HEIGHT - fraction * HEIGHT}
              vectorEffect="non-scaling-stroke"
              style={{ stroke: "var(--border)", strokeWidth: 1 }}
            />
          ))}
          {bars.map((bar, index) => {
            const x = index * slot + (slot - barWidth) / 2;
            let top = HEIGHT;
            return (
              <g
                key={bar.range.from}
                ref={(node) => {
                  refs.current[index] = node;
                }}
                role="img"
                aria-label={barLabel(bar)}
                tabIndex={index === tabStop ? 0 : -1}
                onPointerEnter={() => setActive(index)}
                onPointerLeave={() => setActive((current) => (current === index ? null : current))}
                onFocus={() => {
                  setFocused(index);
                  setActive(index);
                }}
                onBlur={() => setActive((current) => (current === index ? null : current))}
                onKeyDown={(event) => onKeyDown(event, index)}
                className="outline-none"
              >
                {/* Full-height hit area and hover/focus highlight. */}
                <rect
                  x={index * slot}
                  y={0}
                  width={slot}
                  height={HEIGHT}
                  style={{ fill: active === index ? "var(--accent)" : "transparent" }}
                />
                {bar.segments.map((segment) => {
                  const height = Math.max((segment.ms / ceiling) * HEIGHT, 1.5);
                  top -= height;
                  return (
                    <rect
                      key={segment.key}
                      x={x}
                      y={top}
                      width={barWidth}
                      height={height}
                      style={{ fill: tuneCategoryColor(segment.color, dark), stroke: "var(--background)", strokeWidth: 0.5 }}
                    >
                      <title>{`${segment.name}, ${formatDuration(segment.ms)}`}</title>
                    </rect>
                  );
                })}
                {focused === index && active === index && (
                  <rect
                    x={index * slot + 1}
                    y={1}
                    width={slot - 2}
                    height={HEIGHT - 2}
                    fill="none"
                    vectorEffect="non-scaling-stroke"
                    style={{ stroke: "var(--ring)", strokeWidth: 2 }}
                  />
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Offset = y-axis width (w-12) + gap (gap-2), so labels sit under their bars. */}
      <div className="ml-14 mt-1 flex" aria-hidden="true">
        {bars.map((bar, index) => (
          <span
            key={bar.range.from}
            className="tabular min-w-0 flex-1 text-center text-2xs text-muted-foreground"
          >
            {index % step === 0 ? bar.label : ""}
          </span>
        ))}
      </div>

      <p className="tabular mt-2 h-4 truncate text-xs text-muted-foreground" aria-hidden="true">
        {readout ? (
          <>
            <span className="font-medium text-foreground">{readout.fullLabel}</span>
            <span> · {readout.totalMs > 0 ? formatDuration(readout.totalMs) : "nothing tracked"}</span>
          </>
        ) : (
          "Hover or focus a bar for details."
        )}
      </p>
    </div>
  );
}
