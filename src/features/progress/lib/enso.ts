/**
 * The brush geometry of the progress drawings, ported from the design system's `bundle.js`
 * (`ensoPath`, `enso`, `levelPath` and the seal glyphs). Pure functions over a 100 x 100 view
 * box (the ensō), a 400 x 20 one (the level path) and a 56 x 56 one (seals).
 */

/** The stroke starts heavy at the upper right, at this angle (degrees, 0 = 3 o'clock). */
export const ENSO_START = -42;
/** It runs clockwise for this many degrees, leaving an opening at the top right. */
export const ENSO_SWEEP = 332;
/** Where the dot rests, in the opening, once the day is done. */
export const ENSO_REST = -56;

/** Radius of the daily ensō's course in its 100 x 100 view box. */
export const ENSO_RADIUS = 38;

/** Two decimals, like the design system, so paths stay short and stable. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A point at radius `r` and angle `deg` around (50, 50). */
export function polar(r: number, deg: number): [number, number] {
  const t = (deg * Math.PI) / 180;
  return [50 + r * Math.cos(t), 50 + r * Math.sin(t)];
}

function clamp01(p: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0));
}

/**
 * Path data of the brush arc drawn up to `p` (0..1) on radius `r`, thinning from width `w0` to
 * `w1` along the full sweep, with round ends. Empty at `p = 0`.
 */
export function ensoPath(p: number, r: number, w0: number, w1: number): string {
  p = clamp01(p);
  if (p === 0) return "";
  const end = ENSO_START + ENSO_SWEEP * p;
  const steps = Math.max(4, Math.ceil((ENSO_SWEEP * p) / 3));
  const outer: [number, number][] = [];
  const inner: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = ENSO_START + ((end - ENSO_START) * i) / steps;
    const w = w0 + (w1 - w0) * ((a - ENSO_START) / ENSO_SWEEP);
    outer.push(polar(r + w / 2, a));
    inner.push(polar(r - w / 2, a));
  }
  const wEnd = w0 + (w1 - w0) * p;
  const f = round2;
  let d = `M${f(outer[0]![0])} ${f(outer[0]![1])}`;
  for (let i = 1; i < outer.length; i++) d += `L${f(outer[i]![0])} ${f(outer[i]![1])}`;
  const tip = inner[inner.length - 1]!;
  d += `A${f(wEnd / 2)} ${f(wEnd / 2)} 0 0 1 ${f(tip[0])} ${f(tip[1])}`;
  for (let i = inner.length - 2; i >= 0; i--) d += `L${f(inner[i]![0])} ${f(inner[i]![1])}`;
  d += `A${f(w0 / 2)} ${f(w0 / 2)} 0 0 1 ${f(outer[0]![0])} ${f(outer[0]![1])}Z`;
  return d;
}

/** Everything the daily ensō draws for progress `p`, with a brush of width `weight`. */
export interface EnsoShape {
  /** The full course, a thin 3-unit line. */
  track: string;
  /** The drawn part; empty at 0. */
  ink: string;
  dot: { cx: number; cy: number; r: number };
}

/**
 * The daily ensō at `p` (today's strokes over the cap). Below 1 the dot sits just ahead of the
 * brush tip (the next step); at 1 it rests in the opening, exactly like the mark.
 */
export function ensoShape(p: number, weight = 13): EnsoShape {
  p = clamp01(p);
  const w1 = weight * 0.22;
  const at = p >= 1 ? ENSO_REST : ENSO_START + ENSO_SWEEP * p + (p > 0 ? 9 : 0);
  const [cx, cy] = polar(ENSO_RADIUS, at);
  return {
    track: ensoPath(1, ENSO_RADIUS, 3, 3),
    ink: ensoPath(p, ENSO_RADIUS, weight, w1),
    dot: { cx: round2(cx), cy: round2(cy), r: round2(weight * 0.42) },
  };
}

/** The level path's view box. */
export const LEVEL_PATH_WIDTH = 400;
export const LEVEL_PATH_HEIGHT = 20;

export interface LevelPathShape {
  track: { x: number; y: number; width: number; height: number; rx: number };
  /** One horizontal brush stroke that thins as it goes; empty at 0. */
  ink: string;
  dot: { cx: number; cy: number; r: number };
}

/** The level path at `p` (strokes into this level over the level's span). */
export function levelPathShape(p: number): LevelPathShape {
  p = clamp01(p);
  const W = LEVEL_PATH_WIDTH;
  const H = LEVEL_PATH_HEIGHT;
  const x0 = 8;
  const x1 = W - 12;
  const h0 = 7;
  const h1 = 2;
  const y = H / 2;
  const f = round2;
  let ink = "";
  if (p > 0) {
    const xe = x0 + (x1 - x0) * p;
    const he = h0 + (h1 - h0) * p;
    ink =
      `M${x0} ${y - h0}L${f(xe)} ${f(y - he)}A${f(he)} ${f(he)} 0 0 1 ${f(xe)} ${f(y + he)}` +
      `L${x0} ${y + h0}A${h0} ${h0} 0 0 1 ${x0} ${y - h0}Z`;
  }
  const dx = x0 + (x1 - x0) * p + (p > 0 ? 8 : 0);
  return {
    track: { x: x0, y: y - 1.5, width: x1 - x0, height: 3, rx: 1.5 },
    ink,
    dot: { cx: f(Math.min(dx, W - 4)), cy: y, r: 5 },
  };
}

/** A point at radius `r` and angle `deg` around the seal's center (28, 28). */
export function sealPoint(r: number, deg: number): [number, number] {
  const t = (deg * Math.PI) / 180;
  return [round2(28 + r * Math.cos(t)), round2(28 + r * Math.sin(t))];
}

/** Seal glyphs: geometry only, never icons or emoji. */
export type SealGlyph = "dot" | "seven" | "ten" | "pause" | "ring" | "dotted";

/** Shapes of a glyph on the 56 x 56 grid: filled circles, filled bars and stroked lines. */
export interface GlyphShapes {
  dots: { cx: number; cy: number; r: number }[];
  bars: { x: number; y: number; width: number; height: number; rx: number }[];
  lines: string[];
  rings: { r: number; strokeWidth?: number; dashArray?: string }[];
}

export function sealGlyphShapes(glyph: SealGlyph): GlyphShapes {
  const shapes: GlyphShapes = { dots: [], bars: [], lines: [], rings: [] };
  switch (glyph) {
    case "dot":
      shapes.dots.push({ cx: 28, cy: 28, r: 7 });
      break;
    case "seven":
      // Seven dots on an open arc: the ensō's own course.
      for (let i = 0; i < 7; i++) {
        const [cx, cy] = sealPoint(14, ENSO_START + (i * ENSO_SWEEP) / 6);
        shapes.dots.push({ cx, cy, r: 3 });
      }
      break;
    case "ten":
      for (let i = 0; i < 10; i++) {
        const a = sealPoint(9, i * 36 - 90);
        const b = sealPoint(15, i * 36 - 90);
        shapes.lines.push(`M${a.join(" ")}L${b.join(" ")}`);
      }
      break;
    case "pause":
      shapes.bars.push({ x: 19, y: 17, width: 6, height: 22, rx: 3 }, { x: 31, y: 17, width: 6, height: 22, rx: 3 });
      break;
    case "ring":
      // The only closed circle in Kaiflow.
      shapes.rings.push({ r: 12, strokeWidth: 4.5 });
      break;
    case "dotted":
      shapes.rings.push({ r: 13, dashArray: "0 6.8" });
      break;
  }
  return shapes;
}

/** Where the new-seal dot sits: on the rim, at the ensō's rest angle. */
export function sealNewDot(): { cx: number; cy: number; r: number } {
  const [cx, cy] = sealPoint(26, ENSO_REST);
  return { cx, cy, r: 6 };
}
