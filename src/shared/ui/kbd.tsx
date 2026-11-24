import type { ComponentProps } from "react";

import { cn } from "@/shared/lib/utils";

/** A keyboard shortcut as a small pill. */
export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-border bg-surface px-1.5 font-sans text-2xs text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
