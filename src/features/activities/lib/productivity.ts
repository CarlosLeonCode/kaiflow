import type { Messages } from "@/shared/i18n";
import type { ProductivityDto } from "@/shared/ipc";
import type { SegmentedOption } from "@/shared/ui/segmented";

/** Productivity choices, in display order. */
export const PRODUCTIVITY_VALUES: readonly ProductivityDto[] = ["productive", "neutral", "distracting"];

/** Options of the productivity selector, labelled in the active language. */
export function productivityOptions(t: Messages): SegmentedOption<ProductivityDto>[] {
  return PRODUCTIVITY_VALUES.map((value) => ({ value, label: t.activities.productivity.options[value] }));
}

export const DEFAULT_PRODUCTIVITY: ProductivityDto = "neutral";

export function productivityLabel(value: ProductivityDto, t: Messages): string {
  return t.activities.productivity.options[value];
}

/** Values the create/edit form hands to the container. */
export interface ActivityFormValue {
  name: string;
  color: string;
  productivity: ProductivityDto;
}
