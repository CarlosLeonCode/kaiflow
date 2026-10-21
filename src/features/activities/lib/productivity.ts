import type { ProductivityDto } from "@/shared/ipc";

/** Options of the productivity selector, in display order. */
export const PRODUCTIVITY_OPTIONS: readonly { value: ProductivityDto; label: string }[] = [
  { value: "productive", label: "Productive" },
  { value: "neutral", label: "Neutral" },
  { value: "distracting", label: "Distracting" },
];

export const DEFAULT_PRODUCTIVITY: ProductivityDto = "neutral";

export function productivityLabel(value: ProductivityDto): string {
  return PRODUCTIVITY_OPTIONS.find((option) => option.value === value)?.label ?? "Neutral";
}

/** Values the create/edit form hands to the container. */
export interface ActivityFormValue {
  name: string;
  color: string;
  productivity: ProductivityDto;
}
