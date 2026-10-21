import { formatDuration } from "@/shared/lib/time";

import type { FocusRatioDto } from "@/shared/ipc";

interface Props {
  productiveMs: number;
  neutralMs: number;
  distractingMs: number;
  ratio: FocusRatioDto;
}

const SEGMENTS = [
  { key: "productive", label: "Productive", color: "var(--success)" },
  { key: "neutral", label: "Neutral", color: "var(--muted-foreground)" },
  { key: "distracting", label: "Distracting", color: "var(--destructive)" },
] as const;

/** Whole percent of the productive share, e.g. `75%`. */
export function ratioText(ratio: FocusRatioDto): string | null {
  // The generated type allows `null` for a non-finite float; treat it as no signal.
  return ratio.kind === "ratio" && ratio.ratio !== null ? `${Math.round(ratio.ratio * 100)}%` : null;
}

/**
 * Productive, neutral and distracting time as one proportional bar. Every part is named with
 * its duration in text (color is never the only carrier), and without any productive or
 * distracting time the ratio says so instead of showing a number.
 */
export function RatioBar({ productiveMs, neutralMs, distractingMs, ratio }: Props) {
  const values = { productive: productiveMs, neutral: neutralMs, distracting: distractingMs };
  const total = productiveMs + neutralMs + distractingMs;
  const percent = ratioText(ratio);
  const parts = SEGMENTS.reduce<{ key: string; color: string; x: number; width: number }[]>((acc, segment) => {
    const previous = acc[acc.length - 1];
    const x = previous ? previous.x + previous.width : 0;
    return [...acc, { key: segment.key, color: segment.color, x, width: total > 0 ? (values[segment.key] / total) * 100 : 0 }];
  }, []);

  return (
    <div>
      {percent ? (
        <p className="tabular text-display font-semibold tracking-tight" data-testid="focus-ratio">
          {percent}
          <span className="ml-2 text-xs font-normal tracking-normal text-muted-foreground">productive</span>
        </p>
      ) : (
        <p className="text-sm font-medium" data-testid="focus-ratio">
          No productive or distracting data
        </p>
      )}
      <p className="mt-0.5 text-xs text-muted-foreground">
        {percent
          ? "Productive time as a share of productive plus distracting time. Neutral time is left out."
          : "Mark activities as productive or distracting in Activities to see this ratio."}
      </p>

      <div className="mt-3 overflow-hidden rounded-full bg-muted">
        <svg
          role="img"
          aria-label={`Time by productivity: ${SEGMENTS.map((s) => `${s.label} ${formatDuration(values[s.key])}`).join(", ")}`}
          viewBox="0 0 100 6"
          preserveAspectRatio="none"
          className="block h-2 w-full"
        >
          {parts.map((part) =>
            part.width > 0 ? (
              <rect key={part.key} x={part.x} y={0} width={part.width} height={6} style={{ fill: part.color }} />
            ) : null,
          )}
        </svg>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        {SEGMENTS.map((segment) => (
          <div key={segment.key}>
            <dt className="flex items-center gap-1.5 text-muted-foreground">
              <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: segment.color }} />
              {segment.label}
            </dt>
            <dd className="tabular font-medium">{formatDuration(values[segment.key])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
