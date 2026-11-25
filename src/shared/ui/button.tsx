import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/shared/lib/utils";

/**
 * Stickers (primary, secondary, destructive) lift 2px on hover and drop 2px on press, losing
 * their hard shadow, only when motion is allowed. Ghost stays flat and quiet.
 */
const STICKER =
  "shadow-(--shadow-sticker) motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0.5 active:shadow-none";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-display text-sm leading-none font-bold transition-[translate,box-shadow,background-color,color] duration-150 ease-spring disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /** Ink pill with the vermilion press shadow: one per view, for the main action. */
        primary: cn(STICKER, "bg-mark-stroke text-on-ink shadow-(--shadow-press)"),
        /** Surface pill with an ink edge. */
        secondary: cn(STICKER, "border-[1.5px] border-mark-stroke bg-background text-foreground hover:bg-surface"),
        ghost: "font-semibold text-muted-foreground hover:bg-accent hover:text-foreground active:bg-muted",
        /** Irreversible actions (inside a confirmation). */
        destructive: cn(STICKER, "bg-destructive text-background hover:bg-destructive/90"),
      },
      size: {
        sm: "h-7 px-3",
        md: "h-8 px-3.5",
        icon: "size-7",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
