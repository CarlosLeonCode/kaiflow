import type { Messages } from "@/shared/i18n";
import type { TrayDisplayDto } from "@/shared/ipc";

export interface TrayDisplayOption {
  value: TrayDisplayDto;
  label: string;
}

/** What the menu bar can show next to the icon, in display order. */
export const TRAY_DISPLAY_VALUES: readonly TrayDisplayDto[] = [
  "off",
  "today_total",
  "current_app",
  "today_and_current",
  "goal_progress",
];

/** The tray choices, labelled with examples that mirror the Rust formatter (`tray_text.rs`). */
export function trayDisplayOptions(t: Messages): TrayDisplayOption[] {
  return TRAY_DISPLAY_VALUES.map((value) => ({ value, label: t.settings.tray.options[value] }));
}

export interface WeekStartOption {
  value: number;
  label: string;
}

/** The usual first days of the week; the stored value is always selectable (0 = Monday). */
export function weekStartOptions(current: number, t: Messages): WeekStartOption[] {
  const names = t.settings.calendar.weekdays;
  const values = new Set<number>([0, 5, 6, current]);
  return [...values]
    .filter((value) => value >= 0 && value <= 6)
    .sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : a - b))
    .map((value) => ({ value, label: names[value] ?? names[0] ?? "" }));
}

/** Narrows the stored string to a known option, falling back to the default. */
export function parseTrayDisplay(value: string): TrayDisplayDto {
  return TRAY_DISPLAY_VALUES.find((option) => option === value) ?? "today_total";
}

/** Idle threshold choices, in minutes; the current value is always selectable. */
const MINUTES = [1, 2, 3, 5, 10, 15, 20, 30, 60] as const;

export interface ThresholdOption {
  secs: number;
  label: string;
}

export function formatThreshold(secs: number, t: Messages): string {
  const units = t.settings.units;
  if (secs % 3600 === 0) return units.hours(secs / 3600);
  if (secs % 60 === 0) return units.minutes(secs / 60);
  return units.seconds(secs);
}

/** Fixed presets plus the stored value when it is not one of them (set before or by hand). */
export function idleThresholdOptions(current: number, t: Messages): ThresholdOption[] {
  const secs = new Set<number>(MINUTES.map((m) => m * 60));
  secs.add(current);
  return [...secs]
    .sort((a, b) => a - b)
    .map((value) => ({ secs: value, label: formatThreshold(value, t) }));
}

const AUTO_DISCARD_SECS = [30, 60, 120, 180, 300] as const;
const PROMPT_TIMEOUT_MINUTES = [1, 2, 5, 10, 15, 30, 60] as const;

function withCurrent(presets: readonly number[], current: number): number[] {
  return [...new Set<number>([...presets, current])].sort((a, b) => a - b);
}

/** "Always ask" (0) plus presets; the stored value is always selectable. */
export function autoDiscardOptions(current: number, t: Messages): ThresholdOption[] {
  const words = t.settings.idle;
  return withCurrent([0, ...AUTO_DISCARD_SECS], current).map((secs) => ({
    secs,
    label: secs === 0 ? words.alwaysAsk : words.shorterThan(formatThreshold(secs, t)),
  }));
}

/** How long the away prompt waits for an answer before the time is discarded. */
export function promptTimeoutOptions(current: number, t: Messages): ThresholdOption[] {
  return withCurrent(
    PROMPT_TIMEOUT_MINUTES.map((m) => m * 60),
    current,
  ).map((secs) => ({ secs, label: formatThreshold(secs, t) }));
}

const FOCUS_DRIFT_SECS = [30, 60, 90, 120, 180, 300] as const;

/** How long off-task before a focus session nudges; the stored value is always selectable. */
export function focusDriftOptions(current: number, t: Messages): ThresholdOption[] {
  return withCurrent(FOCUS_DRIFT_SECS, current).map((secs) => ({ secs, label: formatThreshold(secs, t) }));
}

/** Choices for the pomodoro breaks (minutes) and the blocks before a long break. */
export const SHORT_BREAK_MINUTES = [3, 5, 10, 15] as const;
export const LONG_BREAK_MINUTES = [10, 15, 20, 30] as const;
export const LONG_BREAK_EVERY = [2, 3, 4, 5, 6] as const;

/** The presets plus the stored value when it is not one of them, ascending. */
export function minuteOptions(presets: readonly number[], current: number): number[] {
  return [...new Set([...presets, current])].sort((a, b) => a - b);
}
