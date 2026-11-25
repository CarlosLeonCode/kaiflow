import type { CSSProperties, ReactNode } from "react";

import { useT } from "@/shared/i18n";
import { cn } from "@/shared/lib/utils";

import { ensoPath } from "../lib/enso";
import { POP_BG, type PopTone } from "../lib/progress";

export type KaiPose = "hello" | "focus" | "done" | "rest";

/** The pop each pose stands on by default. */
export const KAI_STAGE: Record<KaiPose, PopTone> = { hello: "sun", focus: "sky", done: "mint", rest: "pink" };

/** Kai's sizes, in px: 44 (badge) to 160 (onboarding). Smaller blurs the face. */
export const KAI_MIN_SIZE = 44;
export const KAI_MAX_SIZE = 160;

interface Props {
  pose: KaiPose;
  /** Width in px, clamped to 44..160. */
  size?: number;
  /**
   * Accessible name; defaults to the pose's description. Pass "" when the text beside Kai
   * already says it, and Kai is hidden from assistive technology.
   */
  label?: string;
  /**
   * The pop sticker Kai stands on: a rounded `stage` card, a round 44px `badge`, or `none`
   * when the parent is already a pop fill (a moment card).
   */
  frame?: "stage" | "badge" | "none";
  /** Stage color; defaults to the pose's (sun, sky, mint, pink). */
  tone?: PopTone;
  /** Pop in once (only without reduced motion). Never loops. */
  animate?: boolean;
  className?: string;
}

const C = {
  ink: "var(--kai-ink)",
  body: "var(--kai-body)",
  cheek: "var(--kai-cheek)",
  dot: "var(--now-dot)",
  glint: "#ffffff",
};

/** A shape's paint: a fill, and optionally an ink stroke (2.5 by default) with round ends. */
function paint(fill: string, stroke?: string, width = 2.5): { style: CSSProperties } {
  return {
    style: stroke
      ? { fill, stroke, strokeWidth: width, strokeLinecap: "round", strokeLinejoin: "round" }
      : { fill },
  };
}

/** An open ink line. */
function line(width = 3) {
  return paint("none", C.ink, width);
}

function Cheeks({ y }: { y: number }) {
  return (
    <>
      <ellipse cx={-27} cy={y} rx={7} ry={4.5} {...paint(C.cheek)} />
      <ellipse cx={27} cy={y} rx={7} ry={4.5} {...paint(C.cheek)} />
    </>
  );
}

function Arm({ x, y, ry, deg }: { x: number; y: number; ry: number; deg: number }) {
  return <ellipse cx={x} cy={y} rx={7} ry={ry} transform={`rotate(${deg} ${x} ${y})`} {...paint(C.body, C.ink)} />;
}

function Feet() {
  return (
    <>
      <ellipse cx={-18} cy={40} rx={10} ry={6} {...paint(C.body, C.ink)} />
      <ellipse cx={18} cy={40} rx={10} ry={6} {...paint(C.body, C.ink)} />
    </>
  );
}

function Body() {
  return <path d="M-44 30C-50-10-30-46 0-46C30-46 50-10 44 30C40 44-40 44-44 30Z" {...paint(C.body, C.ink)} />;
}

/** The tuft is the thin end of the brush stroke: the same pen that drew the ensō. */
function Tuft() {
  return <path d="M2-45C-2-62 14-70 22-64C12-64 6-58 7-45Z" {...paint(C.ink)} />;
}

function Hello() {
  return (
    <>
      <Feet />
      <Arm x={-44} y={14} ry={11} deg={25} />
      <Arm x={47} y={-17} ry={13} deg={30} />
      <Body />
      <Tuft />
      <circle cx={56} cy={-38} r={9} {...paint(C.dot, C.ink)} />
      <ellipse cx={-15} cy={-4} rx={7} ry={9} {...paint(C.ink)} />
      <ellipse cx={15} cy={-4} rx={7} ry={9} {...paint(C.ink)} />
      <circle cx={-12} cy={-8} r={2.6} {...paint(C.glint)} />
      <circle cx={18} cy={-8} r={2.6} {...paint(C.glint)} />
      <Cheeks y={9} />
      <path d="M-5 9Q0 15 5 9" {...line()} />
    </>
  );
}

function Focus() {
  return (
    <>
      <Feet />
      <Body />
      <Tuft />
      {/* The hachimaki: a vermilion headband with its two tails. */}
      <path d="M33-27L52-36L49-24ZM33-23L50-14L43-10Z" {...paint(C.dot, C.ink, 2)} />
      <path d="M-35-26Q0-36 35-26L37-18Q0-28-37-18Z" {...paint(C.dot, C.ink, 2)} />
      <ellipse cx={-15} cy={-2} rx={6} ry={7} {...paint(C.ink)} />
      <ellipse cx={15} cy={-2} rx={6} ry={7} {...paint(C.ink)} />
      <circle cx={-13} cy={-3} r={2} {...paint(C.glint)} />
      <circle cx={17} cy={-3} r={2} {...paint(C.glint)} />
      <path d="M-23-10L-8-7M8-7L23-10" {...line(3.5)} />
      <Cheeks y={10} />
      <path d="M-4 12L4 12" {...line()} />
      <ellipse cx={-28} cy={26} rx={9} ry={6.5} {...paint(C.body, C.ink)} />
      <ellipse cx={28} cy={26} rx={9} ry={6.5} {...paint(C.body, C.ink)} />
    </>
  );
}

/** The brand ensō drawn with the DailyEnso brush, scaled to r = 62 around (0, -6). */
const DONE_ENSO = ensoPath(1, 38, 8, 1.8);

function Done() {
  return (
    <>
      <path d={DONE_ENSO} transform="translate(0 -6) scale(1.632) translate(-50 -50)" {...paint(C.ink)} />
      {/* The dot rests in the opening, like the mark. */}
      <circle cx={34.7} cy={-57.4} r={9} {...paint(C.dot, C.ink)} />
      <Feet />
      <Arm x={-47} y={-16} ry={13} deg={-30} />
      <Arm x={47} y={-16} ry={13} deg={30} />
      <Body />
      <Tuft />
      <path d="M-21-2Q-15-11-9-2M9-2Q15-11 21-2" {...line(3.5)} />
      <Cheeks y={9} />
      <path d="M-7 7Q0 20 7 7Z" {...paint(C.ink, C.ink, 2)} />
      <ellipse cx={0} cy={13} rx={3.2} ry={2.2} {...paint(C.cheek)} />
    </>
  );
}

function Rest() {
  return (
    <>
      <Feet />
      <Body />
      <Tuft />
      <path d="M-21-4Q-15 3-9-4M9-4Q15 3 21-4" {...line(3.5)} />
      <Cheeks y={8} />
      <ellipse cx={0} cy={11} rx={3} ry={3.5} {...paint(C.ink)} />
      <circle cx={0} cy={28} r={11} {...paint(C.dot, C.ink)} />
      <ellipse cx={-13} cy={27} rx={8} ry={6} {...paint(C.body, C.ink)} />
      <ellipse cx={13} cy={27} rx={8} ry={6} {...paint(C.body, C.ink)} />
      <path d="M30-50L40-50L30-40L40-40M45-68L52-68L45-61L52-61" {...line(2.5)} />
    </>
  );
}

const POSES: Record<KaiPose, () => ReactNode> = { hello: Hello, focus: Focus, done: Done, rest: Rest };

const STICKER = "border-2 border-mark-stroke shadow-(--shadow-sticker)";

/** Hello raises the dot to the right: in the round badge, shift it so the dot stays in view. */
const BADGE_SHIFT: Partial<Record<KaiPose, string>> = { hello: "-translate-x-[3px]" };

/** Kai, the mochi mascot, in one of four poses. Always on a pop sticker; one per screen. */
export function Kai({ pose, size = 96, label, frame = "stage", tone, animate = false, className }: Props) {
  const t = useT();
  const name = label ?? t.progress.kai[pose];
  const width = Math.max(KAI_MIN_SIZE, Math.min(KAI_MAX_SIZE, size));
  const a11y = name ? { role: "img", "aria-label": name } : { "aria-hidden": true as const };
  const Pose = POSES[pose];
  const svg = (
    <svg
      viewBox="-72 -78 144 132"
      width={frame === "badge" ? 46 : width}
      height={Math.round(((frame === "badge" ? 46 : width) * 132) / 144)}
      data-pose={pose}
      className={cn(
        "block overflow-visible",
        frame === "badge" && ["-mb-1", BADGE_SHIFT[pose]],
        animate && "motion-safe:animate-kf-pop",
        frame === "none" && className,
      )}
      focusable="false"
      {...a11y}
    >
      <Pose />
    </svg>
  );
  if (frame === "none") return svg;
  const bg = POP_BG[tone ?? KAI_STAGE[pose]];
  if (frame === "badge") {
    return (
      <span
        className={cn(
          "box-border inline-grid size-11 items-end justify-items-center overflow-hidden rounded-full",
          STICKER,
          bg,
          className,
        )}
      >
        {svg}
      </span>
    );
  }
  return (
    <div className={cn("inline-grid place-items-center rounded-card px-3 pt-3 pb-2", STICKER, bg, className)}>
      {svg}
    </div>
  );
}
