import type { ProductivityDto } from "@/shared/ipc";

/** Options of the productivity selector, in display order. */
export const PRODUCTIVITY_OPTIONS: readonly { value: ProductivityDto; label: string }[] = [
  { value: "productive", label: "Productive" },
  { value: "neutral", label: "Neutral" },
  { value: "distracting", label: "Distracting" },
];

/** Plain-language meaning of each choice, with role-agnostic examples. */
export const PRODUCTIVITY_MEANING: Record<ProductivityDto, string> = {
  productive: "Work that moves things forward, like writing, design, analysis or a client project.",
  neutral: "Necessary but not focused work, like email, admin or quick calls.",
  distracting: "Time you would rather spend less on, like social media or videos.",
};

/** Where the choice is used, so nobody has to guess why it matters. */
export const PRODUCTIVITY_USE =
  "It sets the focus percentage in Overview and Review. Goals and Focus sessions use the activities themselves, so a clear set of activities helps there too.";

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
