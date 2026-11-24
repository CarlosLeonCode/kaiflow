import { cn } from "@/shared/lib/utils";

import { ensoShape } from "../lib/enso";

interface Props {
  /** Today's strokes over the daily cap; clamped to 0..1. At 1 the drawing is the mark. */
  progress: number;
  /** Accessible name ("35 of 100 strokes today"); empty hides it from assistive technology. */
  label: string;
  /** Width and height in px: 108 on Goals, 64 in a moment card, 18 in the chip. */
  size?: number;
  /** Brush width at the start, in view-box units. */
  weight?: number;
  /** Drawn on a pop fill: ink in `on-pop`, the course in `on-pop-track`. */
  onPop?: boolean;
  /** Spring the drawn part in once (only without reduced motion). */
  animate?: boolean;
  className?: string;
}

/** Today's strokes as one brush circle that thins clockwise, with the vermilion dot ahead. */
export function DailyEnso({ progress, label, size = 108, weight = 13, onPop = false, animate = false, className }: Props) {
  const shape = ensoShape(progress, weight);
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cn("block shrink-0", className)}
      focusable="false"
      {...a11y}
    >
      <path d={shape.track} className={onPop ? "fill-on-pop-track" : "fill-enso-track"} />
      {shape.ink && (
        <path
          d={shape.ink}
          data-part="ink"
          className={cn(
            onPop ? "fill-on-pop" : "fill-enso-stroke",
            animate && "origin-center motion-safe:animate-kf-draw",
          )}
        />
      )}
      <circle data-part="dot" cx={shape.dot.cx} cy={shape.dot.cy} r={shape.dot.r} className="fill-now-dot" />
    </svg>
  );
}
