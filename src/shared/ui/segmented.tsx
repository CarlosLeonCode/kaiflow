import { RadioGroup } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

interface Props<T extends string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  "aria-label": string;
  disabled?: boolean;
}

/** Single-choice control (radio group semantics, arrow-key navigation). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  "aria-label": label,
}: Props<T>) {
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(next) => onChange(next as T)}
      aria-label={label}
      disabled={disabled}
      orientation="horizontal"
      className="inline-flex gap-0.5 rounded-md border border-border bg-muted p-0.5"
    >
      {options.map((option) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          className={cn(
            "inline-flex h-6 items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50",
            "data-[state=checked]:bg-background data-[state=checked]:text-foreground data-[state=checked]:shadow-[0_0_0_1px_var(--border)]",
          )}
        >
          {option.icon}
          {option.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
