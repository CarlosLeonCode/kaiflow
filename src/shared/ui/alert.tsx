import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/shared/lib/utils";

const alertVariants = cva("flex gap-2 rounded-md border px-3 py-2 text-xs", {
  variants: {
    variant: {
      warning: "border-warning-foreground/20 bg-warning text-warning-foreground",
      neutral: "border-border bg-surface text-foreground",
    },
  },
  defaultVariants: { variant: "neutral" },
});

export function Alert({
  className,
  variant,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return <div role="status" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("font-medium", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("opacity-90", className)} {...props} />;
}
