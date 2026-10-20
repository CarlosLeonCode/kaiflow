import type { ComponentProps } from "react";

import { cn } from "@/shared/lib/utils";

/** Native `<select>` (menus, keyboard and VoiceOver for free) dressed like the rest. */
export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-7 rounded-md border border-border bg-background px-2 text-sm text-foreground hover:bg-accent disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
