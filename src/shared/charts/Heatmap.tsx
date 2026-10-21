import { useEffect, useRef, useState } from "react";

import { formatDuration } from "@/shared/lib/time";

const COLS = 24;
const ROWS = 7;
const CELL = 10;
const INSET = 0.75;
const WIDTH = COLS * CELL;
const HEIGHT = ROWS * CELL;
/** Every Nth hour gets an axis label (the 24-hour number, which stays one short token in every locale). */
const LABEL_STEP = 3;

/** Local weekday names, Monday first (1 Jan 2024 was a Monday). */
export function weekdayName(weekday: number, style: "short" | "long"): string {
  return new Date(2024, 0, 1 + weekday).toLocaleDateString(undefined, { weekday: style });
}

/** Local hour of the day (`9 AM`, `09`), following the user's locale. */
export function hourName(hour: number): string {
  return new Date(2024, 0, 1, hour).toLocaleTimeString(undefined, { hour: "numeric" });
}

interface Props {
  /** Milliseconds per cell, index `weekday * 24 + hour`, weekday 0 = Monday. */
  cells: readonly number[];
  /** Describes the chart for assistive tech. */
  label: string;
}

function cellLabel(weekday: number, hour: number, ms: number): string {
  const when = `${weekdayName(weekday, "long")}, ${hourName(hour)}`;
  return ms > 0 ? `${when}: ${formatDuration(ms)}` : `${when}: nothing tracked`;
}

/** Fill of one cell: the muted surface when empty, otherwise the accent mixed in by share of the busiest cell. */
function fillFor(ms: number, max: number): string {
  if (ms <= 0 || max <= 0) return "var(--muted)";
  const share = Math.pow(ms / max, 0.7);
  const percent = Math.round(22 + 78 * share);
  return `color-mix(in oklab, var(--primary) ${percent}%, var(--muted))`;
}

/**
 * Hand-rolled SVG heatmap of tracked time by local weekday (rows) and hour (columns). It is an
 * ARIA grid with one tab stop: arrow keys move between cells, Home/End jump to the row ends,
 * and the readout under the chart follows hover and focus. A visually hidden table carries the
 * same numbers for screen readers.
 */
export function Heatmap({ cells, label }: Props) {
  const [active, setActive] = useState<{ row: number; col: number } | null>(null);
  const [focused, setFocused] = useState<{ row: number; col: number } | null>(null);
  const refs = useRef<(SVGRectElement | null)[]>([]);
  const wantFocus = useRef(false);

  const valueAt = (row: number, col: number) => cells[row * COLS + col] ?? 0;
  const max = Math.max(0, ...cells);
  const peak = cells.findIndex((ms) => ms === max && max > 0);
  const tabStop = focused ?? (peak >= 0 ? { row: Math.floor(peak / COLS), col: peak % COLS } : { row: 0, col: 0 });
  const readout = active ? { ...active, ms: valueAt(active.row, active.col) } : null;

  useEffect(() => {
    if (wantFocus.current && focused) {
      refs.current[focused.row * COLS + focused.col]?.focus();
      wantFocus.current = false;
    }
  }, [focused]);

  function onKeyDown(event: React.KeyboardEvent, row: number, col: number) {
    const target =
      event.key === "ArrowRight"
        ? { row, col: Math.min(col + 1, COLS - 1) }
        : event.key === "ArrowLeft"
          ? { row, col: Math.max(col - 1, 0) }
          : event.key === "ArrowDown"
            ? { row: Math.min(row + 1, ROWS - 1), col }
            : event.key === "ArrowUp"
              ? { row: Math.max(row - 1, 0), col }
              : event.key === "Home"
                ? { row, col: 0 }
                : event.key === "End"
                  ? { row, col: COLS - 1 }
                  : null;
    if (!target) return;
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
          className="grid h-32 w-8 shrink-0 text-2xs text-muted-foreground"
          style={{ gridTemplateRows: `repeat(${ROWS}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: ROWS }, (_, weekday) => (
            <span key={weekday} className="flex items-center">
              {weekdayName(weekday, "short")}
            </span>
          ))}
        </div>
        <svg
          role="grid"
          aria-label={label}
          aria-rowcount={ROWS}
          aria-colcount={COLS}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="block h-32 min-w-0 flex-1 overflow-visible"
        >
          {Array.from({ length: ROWS }, (_, row) => (
            <g key={row} role="row" aria-rowindex={row + 1}>
              {Array.from({ length: COLS }, (_, col) => {
                const ms = valueAt(row, col);
                const isStop = tabStop.row === row && tabStop.col === col;
                const isFocused = focused?.row === row && focused.col === col;
                return (
                  <rect
                    key={col}
                    ref={(node) => {
                      refs.current[row * COLS + col] = node;
                    }}
                    role="gridcell"
                    aria-colindex={col + 1}
                    aria-label={cellLabel(row, col, ms)}
                    tabIndex={isStop ? 0 : -1}
                    x={col * CELL + INSET}
                    y={row * CELL + INSET}
                    width={CELL - 2 * INSET}
                    height={CELL - 2 * INSET}
                    rx={1.5}
                    vectorEffect="non-scaling-stroke"
                    style={{
                      fill: fillFor(ms, max),
                      stroke: isFocused ? "var(--ring)" : "none",
                      strokeWidth: 2,
                      outline: "none",
                    }}
                    onPointerEnter={() => setActive({ row, col })}
                    onPointerLeave={() =>
                      setActive((current) => (current?.row === row && current.col === col ? null : current))
                    }
                    onFocus={() => {
                      setFocused({ row, col });
                      setActive({ row, col });
                    }}
                    onBlur={() => {
                      setFocused(null);
                      setActive((current) => (current?.row === row && current.col === col ? null : current));
                    }}
                    onKeyDown={(event) => onKeyDown(event, row, col)}
                  />
                );
              })}
            </g>
          ))}
        </svg>
      </div>

      {/* Offset = weekday column (w-8) + gap (gap-2), so hours sit under their columns. */}
      <div className="ml-10 mt-1 flex" aria-hidden="true">
        {Array.from({ length: COLS }, (_, hour) => (
          <span key={hour} className="tabular min-w-0 flex-1 text-2xs text-muted-foreground">
            {hour % LABEL_STEP === 0 ? hour : ""}
          </span>
        ))}
      </div>

      <p className="tabular mt-2 h-4 truncate text-xs text-muted-foreground" aria-hidden="true">
        {readout ? (
          <>
            <span className="font-medium text-foreground">
              {weekdayName(readout.row, "long")}, {hourName(readout.col)}
            </span>
            <span> · {readout.ms > 0 ? formatDuration(readout.ms) : "nothing tracked"}</span>
          </>
        ) : (
          "Hover or focus a cell for details."
        )}
      </p>

      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Weekday</th>
            <th scope="col">Hour</th>
            <th scope="col">Tracked time</th>
          </tr>
        </thead>
        <tbody>
          {cells.flatMap((ms, index) =>
            ms > 0
              ? [
                  <tr key={index}>
                    <th scope="row">{weekdayName(Math.floor(index / COLS), "long")}</th>
                    <td>{hourName(index % COLS)}</td>
                    <td>{formatDuration(ms)}</td>
                  </tr>,
                ]
              : [],
          )}
        </tbody>
      </table>
    </div>
  );
}
