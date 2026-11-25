import type { ComponentProps } from "react";

import { cn } from "@/shared/lib/utils";

/**
 * Single-line text input, same height and border as the other controls. Fields keep a small
 * radius (pills are for things you press); the border firms up on hover.
 */
export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      data-selectable
      className={cn(
        "h-7 rounded-md border border-border bg-background px-2 text-sm text-foreground transition-colors placeholder:text-muted-foreground hover:border-muted-foreground/60 disabled:opacity-50 aria-[invalid=true]:border-destructive",
        className,
      )}
      {...props}
    />
  );
}
