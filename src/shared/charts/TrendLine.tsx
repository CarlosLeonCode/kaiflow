import { useState } from "react";

import { useT, type Messages } from "@/shared/i18n";
import { formatAxisDuration, formatDuration } from "@/shared/lib/time";

import { niceCeiling } from "./scale";

const WIDTH = 1000;
const HEIGHT = 160;

export interface TrendPoint {
  key: number | string;
  /** Long accessible name (`Monday, October 19`). */
  label: string;
  /** Short axis label (`Mon`, `20`). */
  axis: string;
  totalMs: number;
}

interface Props {
  points: readonly TrendPoint[];
  /** Describes the chart for assistive tech, e.g. "Tracked time per day". */
  label: string;
}

function axisStep(count: number): number {
  if (count <= 8) return 1;
  if (count <= 26) return 3;
  return 5;
}

function summarize(points: readonly TrendPoint[], t: Messages): string {
  const peak = points.reduce<TrendPoint | null>(
    (best, point) => (point.totalMs > 0 && (!best || point.totalMs > best.totalMs) ? point : best),
    null,
  );
  if (!peak) return t.charts.nothingTrackedSentence;
  const first = points[0]?.label ?? "";
  const last = points[points.length - 1]?.label ?? "";
  return t.charts.trend.summary(points.length, first, last, formatDuration(peak.totalMs), peak.label);
}

/**
 * Hand-rolled SVG line of tracked time per bucket (area under the line, round axis ceiling).
 * The chart is one labeled image with a spoken summary; the numbers are in a visually hidden
 * table, and the readout under the chart follows the pointer.
 */
export function TrendLine({ points, label }: Props) {
  const t = useT();
  const [active, setActive] = useState<number | null>(null);
  const ceiling = niceCeiling(Math.max(0, ...points.map((point) => point.totalMs)));
  const slot = WIDTH / Math.max(points.length, 1);
  const x = (index: number) => (points.length === 1 ? WIDTH / 2 : index * slot + slot / 2);
  const y = (ms: number) => HEIGHT - (ms / ceiling) * HEIGHT;
  const line = points.map((point, index) => `${x(index)},${y(point.totalMs)}`).join(" ");
  const area =
    points.length > 1 ? `${x(0)},${HEIGHT} ${line} ${x(points.length - 1)},${HEIGHT}` : "";
  const step = axisStep(points.length);
  const readout = active === null ? null : (points[active] ?? null);

  return (
    <div>
      <div className="flex gap-2">
        <div
          aria-hidden="true"
          className="tabular flex h-40 w-12 shrink-0 flex-col justify-between whitespace-nowrap text-right text-2xs text-muted-foreground"
        >
          <span className="-mt-1">{formatAxisDuration(ceiling)}</span>
          <span>{formatAxisDuration(ceiling / 2)}</span>
          <span className="-mb-1">0</span>
        </div>
        <svg
          role="img"
          aria-label={`${label}. ${summarize(points, t)}`}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="block h-40 min-w-0 flex-1 overflow-visible"
          onPointerLeave={() => setActive(null)}
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
          {area && <polygon points={area} style={{ fill: "var(--pop-sun)", opacity: 0.35 }} />}
          {points.length > 1 && (
            <polyline
              points={line}
              fill="none"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
              style={{ stroke: "var(--mark-stroke)", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" }}
            />
          )}
          {points.map((point, index) => (
            <g key={point.key} onPointerEnter={() => setActive(index)}>
              <rect x={index * slot} y={0} width={slot} height={HEIGHT} style={{ fill: "transparent" }} />
              {active === index && (
                <line
                  x1={x(index)}
                  x2={x(index)}
                  y1={0}
                  y2={HEIGHT}
                  vectorEffect="non-scaling-stroke"
                  style={{ stroke: "var(--muted-foreground)", strokeWidth: 1, strokeDasharray: "3 3" }}
                />
              )}
            </g>
          ))}
        </svg>
      </div>

      {/* Offset = y-axis width (w-12) + gap (gap-2), so labels sit under their points. */}
      <div className="ml-14 mt-1 flex" aria-hidden="true">
        {points.map((point, index) => (
          <span key={point.key} className="tabular min-w-0 flex-1 text-center text-2xs text-muted-foreground">
            {index % step === 0 ? point.axis : ""}
          </span>
        ))}
      </div>

      <p className="tabular mt-2 h-4 truncate text-xs text-muted-foreground" aria-hidden="true">
        {readout ? (
          <>
            <span className="font-medium text-foreground">{readout.label}</span>
            <span> · {readout.totalMs > 0 ? formatDuration(readout.totalMs) : t.charts.nothingTracked}</span>
          </>
        ) : (
          t.charts.trend.hint
        )}
      </p>

      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">{t.charts.period}</th>
            <th scope="col">{t.charts.trackedTime}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.key}>
              <th scope="row">{point.label}</th>
              <td>{point.totalMs > 0 ? formatDuration(point.totalMs) : t.charts.nothingTrackedCell}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
