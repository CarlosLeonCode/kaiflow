import { Dialog as DialogPrimitive } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** One sentence under the title: what the dialog is for. */
  description?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Modal dialog for forms, as a sticker card (ink edge, hard shadow). Focus is trapped; Escape
 * and the overlay close it. Use `ConfirmDialog` for yes/no questions: it starts focus on Cancel
 * and never closes itself.
 */
export function Dialog({ open, onOpenChange, title, description, children, className }: Props) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-32px)] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border-2 border-mark-stroke bg-background p-5 shadow-(--shadow-sticker)",
            className,
          )}
        >
          <DialogPrimitive.Title className="font-display text-[18px] leading-[1.2] font-bold tracking-[-0.01em]">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="mt-1 text-xs text-muted-foreground">
              {description}
            </DialogPrimitive.Description>
          ) : (
            <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
          )}
          <div className="mt-4">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
