/** Idle threshold choices, in minutes; the current value is always selectable. */
const MINUTES = [1, 2, 3, 5, 10, 15, 20, 30, 60] as const;

export interface ThresholdOption {
  secs: number;
  label: string;
}

export function formatThreshold(secs: number): string {
  if (secs % 3600 === 0) return secs === 3600 ? "1 hour" : `${secs / 3600} hours`;
  if (secs % 60 === 0) return `${secs / 60} min`;
  return `${secs} sec`;
}

/** Fixed presets plus the stored value when it is not one of them (set before or by hand). */
export function idleThresholdOptions(current: number): ThresholdOption[] {
  const secs = new Set<number>(MINUTES.map((m) => m * 60));
  secs.add(current);
  return [...secs]
    .sort((a, b) => a - b)
    .map((value) => ({ secs: value, label: formatThreshold(value) }));
}
