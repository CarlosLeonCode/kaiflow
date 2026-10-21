import type { DeleteOpDto, RangeDto } from "@/shared/ipc";
import { addLocalDays } from "@/shared/lib/time";

/** Pure helpers for the destructive operations of the Privacy section. */

/** `YYYY-MM-DD` of a local date, the value format of `<input type="date">`. */
export function toDateInput(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  // `new Date(2026, 1, 31)` rolls over to March: reject dates that do not exist.
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/**
 * Local `[start of first day, start of the day after the last day)` for two date inputs
 * (both days inclusive), or `null` when a date is missing, impossible, or the order is wrong.
 * Built from calendar dates so DST days are 23 or 25 hours long, never shifted.
 */
export function rangeFromDays(from: string, to: string): RangeDto | null {
  const first = parseDateInput(from);
  const last = parseDateInput(to);
  if (!first || !last || first.getTime() > last.getTime()) return null;
  return { from: first.getTime(), to: addLocalDays(last.getTime(), 1) };
}

export type DaysProblem = "empty" | "invalid";

/** Whole number of days, at least 1 (the backend rejects 0). */
export function parseDays(value: string): { days: number } | { problem: DaysProblem } {
  if (value.trim() === "") return { problem: "empty" };
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= 36_500 ? { days } : { problem: "invalid" };
}

export interface DeleteCopy {
  title: string;
  /** Plain-language consequences, one paragraph each. */
  paragraphs: string[];
  confirmLabel: string;
}

const dayFormat = { year: "numeric", month: "short", day: "numeric" } as const;

/** Confirmation copy for an operation: what goes, what stays, and that it cannot be undone. */
export function deleteCopy(op: DeleteOpDto, trackingWillRestart = false): DeleteCopy {
  const kept = "Activities, rules, privacy rules and settings are kept.";
  switch (op.kind) {
    case "range": {
      const from = new Date(op.range.from).toLocaleDateString(undefined, dayFormat);
      const last = new Date(addLocalDays(op.range.to, -1)).toLocaleDateString(undefined, dayFormat);
      const span = from === last ? from : `${from} to ${last}`;
      return {
        title: "Delete this date range?",
        paragraphs: [
          `Every recorded segment from ${span} (both days included) is permanently deleted.`,
          `${kept} This cannot be undone.`,
        ],
        confirmLabel: "Delete range",
      };
    }
    case "older_than_days":
      return {
        title: `Delete everything older than ${op.days} ${op.days === 1 ? "day" : "days"}?`,
        paragraphs: [
          `Anything recorded more than ${op.days} ${op.days === 1 ? "day" : "days"} ago is permanently deleted. Newer data stays.`,
          `${kept} This cannot be undone.`,
        ],
        confirmLabel: "Delete older data",
      };
    case "all":
      return {
        title: "Delete all tracked data?",
        paragraphs: [
          "Every recorded segment and every pending idle decision is permanently deleted, so Today and History start empty.",
          trackingWillRestart
            ? `${kept} Tracking pauses for a moment while the data is removed, then continues.`
            : kept,
          "This cannot be undone.",
        ],
        confirmLabel: "Delete everything",
      };
  }
}

/** `Deleted 12 segments`, or the neutral wording when the backend reports no count. */
export function deletedMessage(op: DeleteOpDto, removed: number): string {
  if (op.kind === "all") return "All tracked data was deleted.";
  return removed === 0
    ? "Nothing matched, so nothing was deleted."
    : `Deleted ${removed} ${removed === 1 ? "segment" : "segments"}.`;
}
