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
  { value: "goal_progress", label: "Top goal (2h 10m / 3h)" },
];

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export interface WeekStartOption {
  value: number;
  label: string;
}

/** The usual first days of the week; the stored value is always selectable (0 = Monday). */
export function weekStartOptions(current: number): WeekStartOption[] {
  const values = new Set<number>([0, 5, 6, current]);
  return [...values]
    .filter((value) => value >= 0 && value <= 6)
    .sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : a - b))
    .map((value) => ({ value, label: WEEKDAY_NAMES[value] ?? "Monday" }));
}

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

const FOCUS_DRIFT_SECS = [30, 60, 90, 120, 180, 300] as const;

/** How long off-task before a focus session nudges; the stored value is always selectable. */
export function focusDriftOptions(current: number): ThresholdOption[] {
  return withCurrent(FOCUS_DRIFT_SECS, current).map((secs) => ({ secs, label: formatThreshold(secs) }));
}
