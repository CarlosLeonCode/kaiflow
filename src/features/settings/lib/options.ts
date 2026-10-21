import type { TrayDisplayDto } from "@/shared/ipc";

export interface TrayDisplayOption {
  value: TrayDisplayDto;
  label: string;
}

/** What the menu bar shows next to the icon; examples mirror the Rust formatter (`tray_text.rs`). */
export const TRAY_DISPLAY_OPTIONS: readonly TrayDisplayOption[] = [
  { value: "off", label: "Icon only" },
  { value: "today_total", label: "Today's total (3h 12m)" },
  { value: "current_app", label: "Current app (Xcode · 40m)" },
  { value: "today_and_current", label: "Both (3h 12m · Xcode 40m)" },
];

/** Narrows the stored string to a known option, falling back to the default. */
export function parseTrayDisplay(value: string): TrayDisplayDto {
  return TRAY_DISPLAY_OPTIONS.find((o) => o.value === value)?.value ?? "today_total";
}

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

const AUTO_DISCARD_SECS = [30, 60, 120, 180, 300] as const;
const PROMPT_TIMEOUT_MINUTES = [1, 2, 5, 10, 15, 30, 60] as const;

function withCurrent(presets: readonly number[], current: number): number[] {
  return [...new Set<number>([...presets, current])].sort((a, b) => a - b);
}

/** "Always ask" (0) plus presets; the stored value is always selectable. */
export function autoDiscardOptions(current: number): ThresholdOption[] {
  return withCurrent([0, ...AUTO_DISCARD_SECS], current).map((secs) => ({
    secs,
    label: secs === 0 ? "Always ask" : `Shorter than ${formatThreshold(secs)}`,
  }));
}

/** How long the away prompt waits for an answer before the time is discarded. */
export function promptTimeoutOptions(current: number): ThresholdOption[] {
  return withCurrent(
    PROMPT_TIMEOUT_MINUTES.map((m) => m * 60),
    current,
  ).map((secs) => ({ secs, label: formatThreshold(secs) }));
}
