import { Info, X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "./button";

interface Props {
  title: string;
  children: ReactNode;
  onDismiss: () => void;
}

/** A short, dismissible explanation shown at the top of a section until the user closes it. */
export function SectionIntro({ title, children, onDismiss }: Props) {
  return (
    <aside
      aria-label={`About ${title}`}
      className="mb-4 flex items-start gap-3 rounded-lg border border-border bg-surface px-3 py-2.5"
    >
      <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{children}</p>
      </div>
      <Button variant="ghost" size="icon" aria-label={`Dismiss introduction to ${title}`} onClick={onDismiss}>
        <X />
      </Button>
    </aside>
  );
}
