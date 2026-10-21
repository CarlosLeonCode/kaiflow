import type { RangeDto } from "@/shared/ipc";

/** One colored slice of a stacked bar. */
export interface BarSegment {
  key: string;
  name: string;
  color: string;
  ms: number;
}

/** One bar of `StackedBars` (an hour, a day or a week). */
export interface Bar {
  range: RangeDto;
  /** Short axis label (`Mon`, `20`, `9 AM`). */
  label: string;
  /** Long accessible name (`Monday, October 19`). */
  fullLabel: string;
  totalMs: number;
  segments: BarSegment[];
}
