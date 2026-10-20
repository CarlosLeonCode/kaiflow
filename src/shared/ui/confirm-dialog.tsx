import { AlertDialog } from "radix-ui";
import type { ReactNode } from "react";

import { Button } from "./button";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What will happen, in plain words. Keep the consequences explicit. */
  description: ReactNode;
  confirmLabel: string;
  /** Shows the confirm button in the destructive color. */
  destructive?: boolean;
  /** Disables both buttons while the operation runs. */
  busy?: boolean;
  /** Failure of the last attempt; the dialog stays open so the user can retry or cancel. */
  error?: string | null;
  onConfirm: () => void;
}

/**
 * Modal confirmation (alert dialog semantics: focus is trapped, Escape cancels, focus starts
 * on Cancel so a stray Enter never confirms). It does not close itself on confirm: the caller
 * closes it when the operation succeeds, so a failure can be shown in place.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  busy = false,
  error,
  onConfirm,
}: Props) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-4 shadow-xl">
          <AlertDialog.Title className="text-lg font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="mt-1.5 space-y-2 text-muted-foreground">{description}</div>
          </AlertDialog.Description>
          {error && (
            <p role="alert" className="mt-3 text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button disabled={busy}>Cancel</Button>
            </AlertDialog.Cancel>
            <Button
              variant="primary"
              disabled={busy}
              onClick={onConfirm}
              className={destructive ? "bg-destructive text-background hover:bg-destructive/90" : undefined}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
