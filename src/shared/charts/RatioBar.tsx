import { formatDuration } from "@/shared/lib/time";

import type { FocusRatioDto } from "@/shared/ipc";

interface Props {
  productiveMs: number;
  neutralMs: number;
  distractingMs: number;
  ratio: FocusRatioDto;
}

/** The bar compares only these two, exactly like the headline percentage. */
const SEGMENTS = [
  { key: "productive", label: "Productive", color: "var(--success)" },
  { key: "distracting", label: "Distracting", color: "var(--destructive)" },
] as const;

/** Whole percent of the productive share, e.g. `75%`. */
export function ratioText(ratio: FocusRatioDto): string | null {
  // The generated type allows `null` for a non-finite float; treat it as no signal.
  return ratio.kind === "ratio" && ratio.ratio !== null ? `${Math.round(ratio.ratio * 100)}%` : null;
}

/**
 * Productive against distracting time as one proportional bar, so the bar and the headline
 * percentage always agree (100% looks like a full green bar). Neutral time is not part of the
 * ratio: it is listed as text underneath. Every part is named with its duration in text (color
 * is never the only carrier), and without any productive or distracting time the ratio says so
 * instead of showing a number.
 */
export function RatioBar({ productiveMs, neutralMs, distractingMs, ratio }: Props) {
  const values = { productive: productiveMs, distracting: distractingMs };
  const total = productiveMs + distractingMs;
  const percent = ratioText(ratio);
  const productiveWidth = total > 0 ? (productiveMs / total) * 100 : 0;
  const distractingWidth = total > 0 ? 100 - productiveWidth : 0;

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
          aria-label={`Productive against distracting time: ${SEGMENTS.map((s) => `${s.label} ${formatDuration(values[s.key])}`).join(", ")}`}
          viewBox="0 0 100 6"
          preserveAspectRatio="none"
          className="block h-2 w-full"
        >
          {productiveWidth > 0 && (
            <rect x={0} y={0} width={productiveWidth} height={6} style={{ fill: SEGMENTS[0].color }} />
          )}
          {distractingWidth > 0 && (
            <rect x={productiveWidth} y={0} width={distractingWidth} height={6} style={{ fill: SEGMENTS[1].color }} />
          )}
        </svg>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
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
      <p className="mt-2 text-xs text-muted-foreground" data-testid="neutral-time">
        Neutral: <span className="tabular font-medium text-foreground">{formatDuration(neutralMs)}</span> (not part of the ratio)
      </p>
    </div>
  );
}
