/** Time helpers. All instants are UTC milliseconds, like the backend (design section 3). */

import type { RangeDto } from "@/shared/ipc/bindings";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/**
 * Half-open range `[local midnight, next local midnight)` of the day containing `now`.
 * The end is built from the calendar date, not `+ 24h`, so DST days (23 or 25 hours) are
 * correct (design section 8).
 */
export function localDayRange(now: number): RangeDto {
  const date = new Date(now);
  const from = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const to = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
  return { from, to };
}

/**
 * Local midnight of the day `days` away from the day containing `ms` (negative = past).
 * Calendar arithmetic, never `ms + n * 24h`, so DST days stay correct.
 */
export function addLocalDays(ms: number, days: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime();
}

/** `1h 24m`, `24m`, `45s`. Rounds down to the second; never negative. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / SECOND));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/** Clock-style `1:24:05` used for the live total. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / SECOND));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Compact axis duration: whole hours as `10h`, otherwise `1h 30m`, `30m` or `45s`. Chart axes
 * use round values, so this is shorter than `formatDuration` (`10h 00m`) and never wraps.
 */
export function formatAxisDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / SECOND));
  if (total === 0) return "0";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  if (minutes > 0) return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Local time of day in the user's locale (`1:21 AM`, `13:21`). The hour is `numeric`, so
 * 12-hour locales get no leading zero; every clock time in the UI goes through this helper.
 */
export function formatTimeOfDay(ms: number, locale?: string): string {
  return new Date(ms).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

/** Local hour only (`4 AM`, `16`), for axis ticks. */
export function formatHour(ms: number, locale?: string): string {
  return new Date(ms).toLocaleTimeString(locale, { hour: "numeric" });
}

export { HOUR, MINUTE, SECOND };
