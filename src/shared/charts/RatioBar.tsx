import { useT } from "@/shared/i18n";
import { formatDuration } from "@/shared/lib/time";
import { BIG_NUMBER } from "@/shared/ui/card";

import type { FocusRatioDto } from "@/shared/ipc";

interface Props {
  productiveMs: number;
  neutralMs: number;
  distractingMs: number;
  ratio: FocusRatioDto;
}

/** The bar compares only these two, exactly like the headline percentage. Labels live in `charts.ratio`. */
const SEGMENTS = [
  { key: "productive", color: "var(--pop-mint)" },
  { key: "distracting", color: "var(--pop-pink)" },
] as const;

/** Whole percent of the productive share, e.g. `75%`. */
export function ratioText(ratio: FocusRatioDto): string | null {
  // The generated type allows `null` for a non-finite float; treat it as no signal.
  return ratio.kind === "ratio" && ratio.ratio !== null ? `${Math.round(ratio.ratio * 100)}%` : null;
}

/**
 * Productive against distracting time as one proportional bar, so the bar and the headline
 * percentage always agree (100% looks like a full mint bar). Neutral time is not part of the
 * ratio: it is listed as text underneath. Every part is named with its duration in text (color
 * is never the only carrier), and without any productive or distracting time the ratio says so
 * instead of showing a number.
 */
export function RatioBar({ productiveMs, neutralMs, distractingMs, ratio }: Props) {
  const m = useT().charts.ratio;
  const values = { productive: productiveMs, distracting: distractingMs };
  const total = productiveMs + distractingMs;
  const percent = ratioText(ratio);
  const productiveWidth = total > 0 ? (productiveMs / total) * 100 : 0;
  const distractingWidth = total > 0 ? 100 - productiveWidth : 0;

  return (
    <div>
      {percent ? (
        <p className={BIG_NUMBER} data-testid="focus-ratio">
          {percent}
          <span className="ml-2 font-sans text-xs font-normal tracking-normal text-muted-foreground">{m.productiveSuffix}</span>
        </p>
      ) : (
        <p className="text-sm font-medium" data-testid="focus-ratio">
          {m.noData}
        </p>
      )}
      <p className="mt-0.5 text-xs text-muted-foreground">
        {percent ? m.explainer : m.hint}
      </p>

      <div className="mt-3 overflow-hidden rounded-full border-[1.5px] border-mark-stroke bg-background">
        <svg
          role="img"
          aria-label={m.label(SEGMENTS.map((s) => `${m[s.key]} ${formatDuration(values[s.key])}`).join(", "))}
          viewBox="0 0 100 6"
          preserveAspectRatio="none"
          className="block h-2.5 w-full"
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
              <span aria-hidden="true" className="size-2.5 rounded-full border-[1.5px] border-mark-stroke" style={{ backgroundColor: segment.color }} />
              {m[segment.key]}
            </dt>
            <dd className="tabular font-medium">{formatDuration(values[segment.key])}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted-foreground" data-testid="neutral-time">
        {m.neutral} <span className="tabular font-medium text-foreground">{formatDuration(neutralMs)}</span> {m.neutralNote}
      </p>
    </div>
  );
}
