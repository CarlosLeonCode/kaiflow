import { MINUTE } from "@/shared/lib/time";

const CEILING_STEPS = [5, 10, 15, 30, 60, 120, 180, 240, 360, 480, 600, 720, 960, 1440].map((m) => m * MINUTE);

/** Smallest "round" chart ceiling (5 min .. 24 h) that fits `maxMs`. */
export function niceCeiling(maxMs: number): number {
  if (maxMs <= 0) return 60 * MINUTE;
  return CEILING_STEPS.find((step) => step >= maxMs) ?? Math.ceil(maxMs / (60 * MINUTE)) * 60 * MINUTE;
}
