import { cn } from "@/shared/lib/utils";

import { sealGlyphShapes, sealNewDot, type SealGlyph } from "../lib/enso";
import type { PopTone } from "../lib/progress";

export type SealState = "earned" | "new" | "locked";

interface Props {
  glyph: SealGlyph;
  /** The family's pop color: sky focus, sun streaks, mint breaks, pink goals. */
  tone: PopTone;
  state: SealState;
  /** Accessible name of the sticker ("Seven days, earned"). */
  label: string;
  /** Visible name under the sticker; omitted inside a moment card, whose title names it. */
  name?: string;
  /** Progress while locked ("12 of 30 days"). */
  hint?: string;
  /** Earned stickers are stuck on by hand: alternate the tilt in a grid. */
  tilt?: "left" | "right";
  /** Sticker size in px: 68 on Goals, 60 in a moment card. */
  size?: number;
  className?: string;
}

const DISC_FILL: Record<PopTone, string> = {
  sun: "fill-pop-sun",
  mint: "fill-pop-mint",
  sky: "fill-pop-sky",
  pink: "fill-pop-pink",
};

/** A one-time achievement as a sticker: a pop disc with an ink rim and a geometric glyph. */
export function Seal({ glyph, tone, state, label, name, hint, tilt = "left", size = 68, className }: Props) {
  const locked = state === "locked";
  const shapes = sealGlyphShapes(glyph);
  const fill = locked ? "fill-seal-locked" : "fill-on-pop";
  const line = cn("fill-none [stroke-linecap:round]", locked ? "stroke-seal-locked" : "stroke-on-pop");
  const newDot = sealNewDot();
  return (
    <figure data-state={state} className={cn("group m-0 grid justify-items-center gap-2 text-center", className)}>
      <svg
        viewBox="0 0 56 56"
        width={size}
        height={size}
        role="img"
        aria-label={label}
        focusable="false"
        className={cn(
          "overflow-visible",
          !locked && [
            "[filter:drop-shadow(0_3px_0_var(--mark-stroke))] motion-safe:transition-transform motion-safe:duration-150",
            tilt === "left" ? "-rotate-5" : "rotate-4",
            "group-hover:translate-y-[-3px] group-hover:rotate-0",
          ],
        )}
      >
        <circle
          cx={28}
          cy={28}
          r={26}
          data-part="disc"
          className={locked ? "fill-none stroke-seal-locked" : cn(DISC_FILL[tone], "stroke-mark-stroke")}
          strokeWidth={locked ? 2 : 2.5}
          strokeDasharray={locked ? "4 5" : undefined}
        />
        <g>
          {shapes.dots.map((dot) => (
            <circle key={`${dot.cx},${dot.cy}`} {...dot} className={fill} />
          ))}
          {shapes.bars.map((bar) => (
            <rect key={bar.x} {...bar} className={fill} />
          ))}
          {shapes.lines.map((d) => (
            <path key={d} d={d} className={line} strokeWidth={3} />
          ))}
          {shapes.rings.map((ring) => (
            <circle
              key={ring.r}
              cx={28}
              cy={28}
              r={ring.r}
              className={line}
              strokeWidth={ring.strokeWidth ?? 3}
              strokeDasharray={ring.dashArray}
            />
          ))}
        </g>
        {state === "new" && (
          <circle {...newDot} data-part="new" className="fill-now-dot stroke-mark-stroke" strokeWidth={2.5} />
        )}
      </svg>
      {(name || (locked && hint)) && (
        <figcaption>
          {name && <div className="font-display text-sm leading-4 font-bold text-foreground">{name}</div>}
          {locked && hint && <div className="text-2xs font-semibold text-muted-foreground">{hint}</div>}
        </figcaption>
      )}
    </figure>
  );
}
