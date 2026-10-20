import type { ComponentProps } from "react";

import { cn } from "@/shared/lib/utils";

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-surface px-1 font-sans text-2xs text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
