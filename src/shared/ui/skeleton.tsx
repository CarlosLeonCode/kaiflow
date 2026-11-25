import type { ComponentProps } from "react";

import { cn } from "@/shared/lib/utils";

/** Placeholder block while data loads; it only pulses when motion is allowed. */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn("rounded-card bg-muted motion-safe:animate-pulse", className)}
      {...props}
    />
  );
}
