import type { ComponentProps } from "react";

import { cn } from "@/shared/lib/utils";

/** Single-line text input, same height and border as the other controls. */
export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      data-selectable
      className={cn(
        "h-7 rounded-md border border-border bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-50 aria-[invalid=true]:border-destructive",
        className,
      )}
      {...props}
    />
  );
}
