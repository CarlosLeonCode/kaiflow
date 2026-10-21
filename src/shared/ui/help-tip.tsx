import { CircleHelp } from "lucide-react";
import { Popover } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

interface Props {
  /** Names what the tip explains; the trigger is announced as "About <label>". */
  label: string;
  children: ReactNode;
  className?: string;
}

/**
 * A small "?" next to a control that opens a short plain-language explanation. It is a
 * toggletip (click, Enter or Space opens it, Escape closes it) rather than a hover tooltip, so
 * it works with the keyboard and on trackpads alike.
 */
export function HelpTip({ label, children, className }: Props) {
  return (
    <Popover.Root>
      <Popover.Trigger
        type="button"
        aria-label={`About ${label}`}
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground",
          className,
        )}
      >
        <CircleHelp className="size-3.5" aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          aria-label={label}
          className="z-50 max-w-72 rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground shadow-lg"
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
