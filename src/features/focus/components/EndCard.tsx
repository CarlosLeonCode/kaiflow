import { CircleCheck, Coffee } from "lucide-react";

import type { FocusCardDto, FocusCycleDto } from "@/shared/ipc";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

import { EXTEND_MINUTES, blockTitle, endCardCopy } from "../lib/focus";
import { RoundDots } from "./RoundDots";

interface Props {
  card: FocusCardDto;
  cycle: FocusCycleDto;
  compact?: boolean;
  busy?: boolean;
  error?: string | null;
  onStartNext: () => void;
  onSkip: () => void;
  onMoreTime: (minutes: number) => void;
}

/**
 * Shown when a block ran its course: what ended, what comes next, and three ways on: start it,
 * skip it, or a few more minutes of the same block.
 */
export function EndCard({ card, cycle, compact = false, busy = false, error, onStartNext, onSkip, onMoreTime }: Props) {
  const copy = endCardCopy(card);
  const nextIsBreak = card.next?.kind === "break";
  const Icon = nextIsBreak ? Coffee : CircleCheck;
  const size = compact ? "sm" : "md";
  return (
    <section
      aria-label="Block finished"
      className={cn("rounded-xl border border-border bg-surface", compact ? "p-3" : "px-6 py-6 text-center")}
    >
      <div className={cn("flex gap-3", compact ? "items-start" : "flex-col items-center")}>
        <span
          aria-hidden="true"
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full",
            compact ? "size-9" : "size-12",
            nextIsBreak ? "bg-success/15 text-success" : "bg-primary/12 text-primary",
          )}
        >
          <Icon className={compact ? "size-4.5" : "size-6"} />
        </span>
        <div className="min-w-0">
          <h2 className={cn("font-semibold", compact ? "text-sm" : "text-lg")}>{copy.title}</h2>
          <p className="truncate text-xs text-muted-foreground" title={card.finished.intent || undefined}>
            {blockTitle(card.finished)}
          </p>
          <p className={cn("mt-1", compact ? "text-sm" : "text-base")}>{copy.prompt}</p>
        </div>
      </div>
      <RoundDots cycle={cycle} className={cn("mt-3", !compact && "justify-center")} />
      <div className={cn("mt-3 flex gap-2", !compact && "justify-center")}>
        {copy.startLabel && (
          <Button size={size} variant="primary" disabled={busy} onClick={onStartNext} className={cn(compact && "flex-1")}>
            {copy.startLabel}
          </Button>
        )}
        <Button size={size} disabled={busy} onClick={onSkip} className={cn(compact && "flex-1")}>
          {copy.startLabel ? "Skip" : "Done"}
        </Button>
        <Button size={size} variant="ghost" disabled={busy} onClick={() => onMoreTime(EXTEND_MINUTES)} className={cn(compact && "flex-1")}>
          +{EXTEND_MINUTES} min
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
