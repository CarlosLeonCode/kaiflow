import type { Messages } from "@/shared/i18n";
import type { RetentionPatchDto } from "@/shared/ipc";

/** Automatic cleanup choices (R10.4 keeps data forever by default). */
const PRESETS = [30, 90, 180, 365] as const;

export interface RetentionOption {
  /** `forever` or the number of days as text, the value of the `<select>`. */
  value: string;
  label: string;
}

export function retentionOptions(current: number | null, t: Messages): RetentionOption[] {
  const words = t.privacy.cleanup;
  const days = [...PRESETS] as number[];
  if (current !== null && !days.includes(current)) days.push(current);
  days.sort((a, b) => a - b);
  return [
    { value: "forever", label: words.forever },
    ...days.map((d) => ({ value: String(d), label: d === 365 ? words.year : words.days(d) })),
  ];
}

export function retentionValue(current: number | null): string {
  return current === null ? "forever" : String(current);
}

export function retentionPatch(value: string): RetentionPatchDto {
  return value === "forever" ? { kind: "forever" } : { kind: "days", days: Number(value) };
}
