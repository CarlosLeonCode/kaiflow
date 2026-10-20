import type { RetentionPatchDto } from "@/shared/ipc";

/** Automatic cleanup choices (R10.4 keeps data forever by default). */
const PRESETS = [30, 90, 180, 365] as const;

export interface RetentionOption {
  /** `forever` or the number of days as text, the value of the `<select>`. */
  value: string;
  label: string;
}

export function retentionOptions(current: number | null): RetentionOption[] {
  const days = [...PRESETS] as number[];
  if (current !== null && !days.includes(current)) days.push(current);
  days.sort((a, b) => a - b);
  return [
    { value: "forever", label: "Keep forever" },
    ...days.map((d) => ({ value: String(d), label: d === 365 ? "1 year" : `${d} days` })),
  ];
}

export function retentionValue(current: number | null): string {
  return current === null ? "forever" : String(current);
}

export function retentionPatch(value: string): RetentionPatchDto {
  return value === "forever" ? { kind: "forever" } : { kind: "days", days: Number(value) };
}
