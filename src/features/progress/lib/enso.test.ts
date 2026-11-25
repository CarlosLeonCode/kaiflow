import { describe, expect, it } from "vitest";

import {
  ENSO_RADIUS,
  ENSO_REST,
  ENSO_START,
  ENSO_SWEEP,
  ensoPath,
  ensoShape,
  levelPathShape,
  polar,
  round2,
  sealGlyphShapes,
  sealNewDot,
} from "./enso";

/** The points of a path's `M`/`L` commands, in order. */
function points(d: string): [number, number][] {
  return [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

function angleOf([x, y]: [number, number]): number {
  return (Math.atan2(y - 50, x - 50) * 180) / Math.PI;
}

/** Same angle modulo 360, within rounding. */
function expectAngle(actual: number, expected: number) {
  const diff = (((actual - expected) % 360) + 540) % 360 - 180;
  expect(Math.abs(diff)).toBeLessThan(0.1);
}

describe("ensoPath", () => {
  it("is empty at p = 0 (and below)", () => {
    expect(ensoPath(0, ENSO_RADIUS, 13, 3)).toBe("");
    expect(ensoPath(-0.5, ENSO_RADIUS, 13, 3)).toBe("");
  });

  it("starts heavy at the upper right and ends the arc at the right angle", () => {
    for (const p of [0.08, 0.35, 0.8, 1]) {
      const d = ensoPath(p, ENSO_RADIUS, 13, 2.86);
      const [first, ...rest] = points(d.split("A")[0]!);
      expectAngle(angleOf(first!), ENSO_START);
      // The outer edge runs clockwise and stops where the brush has drawn to.
      expectAngle(angleOf(rest[rest.length - 1]!), ENSO_START + ENSO_SWEEP * p);
      expect(d.endsWith("Z")).toBe(true);
    }
  });

  it("thins along the sweep: the tip is narrower than the start", () => {
    const d = ensoPath(1, ENSO_RADIUS, 13, 2.86);
    const caps = [...d.matchAll(/A([\d.]+) /g)].map((m) => Number(m[1]));
    expect(caps).toEqual([round2(2.86 / 2), round2(13 / 2)]);
  });

  it("clamps p above 1 to the full stroke", () => {
    expect(ensoPath(1.4, ENSO_RADIUS, 13, 3)).toBe(ensoPath(1, ENSO_RADIUS, 13, 3));
  });
});

describe("ensoShape", () => {
  it("draws only the track and the dot at 0, the dot at the start", () => {
    const shape = ensoShape(0);
    expect(shape.ink).toBe("");
    expect(shape.track).not.toBe("");
    const [cx, cy] = polar(ENSO_RADIUS, ENSO_START);
    expect(shape.dot).toEqual({ cx: round2(cx), cy: round2(cy), r: round2(13 * 0.42) });
  });

  it("puts the dot just ahead of the brush tip below 1", () => {
    const shape = ensoShape(0.35);
    expectAngle(angleOf([shape.dot.cx, shape.dot.cy]), ENSO_START + ENSO_SWEEP * 0.35 + 9);
  });

  it("rests the dot in the opening at 1, like the mark", () => {
    const shape = ensoShape(1);
    const [cx, cy] = polar(ENSO_RADIUS, ENSO_REST);
    expect(shape.dot.cx).toBe(round2(cx));
    expect(shape.dot.cy).toBe(round2(cy));
    expect(shape.ink).not.toBe("");
  });
});

describe("levelPathShape", () => {
  it("has no ink at 0 and the dot at the start", () => {
    const shape = levelPathShape(0);
    expect(shape.ink).toBe("");
    expect(shape.dot.cx).toBe(8);
  });

  it("keeps the dot inside the view box at the end", () => {
    const shape = levelPathShape(1);
    expect(shape.ink).not.toBe("");
    expect(shape.dot.cx).toBe(396);
  });
});

describe("seal glyphs", () => {
  it("draws the counts as geometry", () => {
    expect(sealGlyphShapes("dot").dots).toHaveLength(1);
    expect(sealGlyphShapes("seven").dots).toHaveLength(7);
    expect(sealGlyphShapes("ten").lines).toHaveLength(10);
    expect(sealGlyphShapes("pause").bars).toHaveLength(2);
    expect(sealGlyphShapes("ring").rings).toEqual([{ r: 12, strokeWidth: 4.5 }]);
    expect(sealGlyphShapes("dotted").rings[0]?.dashArray).toBe("0 6.8");
  });

  it("lays the seven dots on the ensō's open course", () => {
    const dots = sealGlyphShapes("seven").dots;
    const angle = (d: { cx: number; cy: number }) => (Math.atan2(d.cy - 28, d.cx - 28) * 180) / Math.PI;
    expectAngle(angle(dots[0]!), ENSO_START);
    expectAngle(angle(dots[6]!), ENSO_START + ENSO_SWEEP);
  });

  it("puts the new-seal dot on the rim at the rest angle", () => {
    const dot = sealNewDot();
    expect(Math.hypot(dot.cx - 28, dot.cy - 28)).toBeCloseTo(26, 1);
  });
});
