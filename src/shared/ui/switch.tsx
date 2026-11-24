import { Switch as SwitchPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/shared/lib/utils";

/**
 * Sticker toggle: a pill with an ink edge that fills mint when on. The thumb is ink on paper
 * when off and on-pop ink on mint when on, so both states read in either theme. Always give it
 * an accessible name (`aria-label` or a `<label>`).
 */
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-mark-stroke bg-background p-px transition-colors duration-150 data-[state=checked]:bg-pop-mint disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-3.5 rounded-full bg-mark-stroke transition-[translate,background-color] duration-150 ease-spring data-[state=checked]:translate-x-4 data-[state=checked]:bg-on-pop" />
    </SwitchPrimitive.Root>
  );
}
