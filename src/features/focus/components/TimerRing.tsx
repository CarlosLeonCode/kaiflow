import type { ReactNode } from "react";

import type { FocusKindDto } from "@/shared/ipc";
import { cn } from "@/shared/lib/utils";

interface Props {
  /** Share of the block that has passed, 0..1. */
  progress: number;
  kind: FocusKindDto;
  paused?: boolean;
  /** Outer size in CSS pixels. */
  size: number;
  stroke?: number;
  /** Centered content (the countdown). */
  children: ReactNode;
}

/**
 * Circular progress of a block: a quiet track and an arc that fills clockwise from the top.
 * Accent blue while working, calm green during a break. The arc eases between the one-second
 * updates unless the user asked for reduced motion.
 */
export function TimerRing({ progress, kind, paused = false, size, stroke = 6, children }: Props) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(1, Math.max(0, progress));
  const color = kind === "break" ? "var(--success)" : "var(--primary)";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        <circle
          data-testid="timer-ring-progress"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          className={cn(
            "motion-safe:transition-[stroke-dashoffset,opacity] motion-safe:duration-1000 motion-safe:ease-linear",
            paused && "opacity-45",
          )}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}
