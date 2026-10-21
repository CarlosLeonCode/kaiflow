import type { FocusCycleDto } from "@/shared/ipc";
import { cn } from "@/shared/lib/utils";

import { roundDots } from "../lib/focus";

/** `● ● ○ ○`: work blocks completed in the pomodoro cycle; the long break comes after the last. */
export function RoundDots({ cycle, className }: { cycle: FocusCycleDto; className?: string }) {
  if (!cycle.enabled) return null;
  const dots = roundDots(cycle.round, cycle.every);
  const done = dots.filter(Boolean).length;
  return (
    <div
      role="img"
      aria-label={`${done} of ${dots.length} blocks before the long break`}
      className={cn("flex items-center gap-1.5", className)}
    >
      {dots.map((filled, index) => (
        <span
          // The dots have no identity beyond their position.
          key={index}
          className={cn(
            "size-1.5 rounded-full",
            filled ? "bg-foreground/70" : "border border-muted-foreground/50 bg-transparent",
          )}
        />
      ))}
    </div>
  );
}
