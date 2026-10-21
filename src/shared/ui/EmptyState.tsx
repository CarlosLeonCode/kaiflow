import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

import { Button } from "./button";

interface Props {
  title: string;
  /** One or two sentences: why it is empty and what to do next. */
  children?: ReactNode;
  /** The next step; a section with nothing to show should always offer one when it can. */
  action?: { label: string; onClick: () => void };
  className?: string;
}

/** What a section shows when it has no data: an explanation plus, ideally, the next step. */
export function EmptyState({ title, children, action, className }: Props) {
  return (
    <div className={cn("mx-auto mt-16 max-w-sm text-center", className)}>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <p className="mt-1 text-muted-foreground">{children}</p>}
      {action && (
        <Button className="mt-4" variant="primary" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
