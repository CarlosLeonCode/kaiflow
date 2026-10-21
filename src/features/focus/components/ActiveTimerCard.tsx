import { Pause, Play } from "lucide-react";

import type { FocusActiveDto, FocusCycleDto } from "@/shared/ipc";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

import { EXTEND_MINUTES, allowedSummary, countdownText, kindLabel, progress, remainingLabel, remainingMs } from "../lib/focus";
import { DriftCard } from "./DriftCard";
import { RoundDots } from "./RoundDots";
import { TimerRing } from "./TimerRing";

interface Props {
  session: FocusActiveDto;
  now: number;
  cycle: FocusCycleDto;
  /** The popover variant: ring beside the text, no allowed summary. */
  compact?: boolean;
  busy?: boolean;
  error?: string | null;
  onPause: () => void;
  onResume: () => void;
  onExtend: (minutes: number) => void;
  onEnd: () => void;
  onAllowApp: (appId: string) => void;
  onBackToIt: () => void;
}

/** Mode chip: a colored dot (accent for work, green for a break) and the mode name. */
function ModeLabel({ session }: { session: FocusActiveDto }) {
  const paused = session.paused_at !== null;
  return (
    <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", session.kind === "break" ? "bg-success" : "bg-primary", paused && "opacity-40")}
      />
      {kindLabel(session.kind)}
      {paused && <span className="font-medium normal-case tracking-normal">· Paused</span>}
    </p>
  );
}

/**
 * The running block: a progress ring with the time left, what it is for, the pomodoro round
 * and the controls. A focus block also carries the drift card when one is due.
 */
export function ActiveTimerCard({
  session,
  now,
  cycle,
  compact = false,
  busy = false,
  error,
  onPause,
  onResume,
  onExtend,
  onEnd,
  onAllowApp,
  onBackToIt,
}: Props) {
  const left = remainingMs(session, now);
  const done = progress(session, now);
  const paused = session.paused_at !== null;
  const task = session.intent.trim();
  const countdown = (
    <p
      role="timer"
      data-testid="focus-countdown"
      aria-label={paused ? `Paused, ${remainingLabel(left).toLowerCase()}` : remainingLabel(left)}
      className={cn(
        "tabular tracking-tight",
        compact ? "text-xl font-semibold" : "text-display font-light",
        // Opacity, not a color class: tailwind-merge would take `text-display` for a color.
        paused && "opacity-60",
      )}
    >
      {countdownText(left)}
    </p>
  );
  const controls = (
    <div className={cn("flex gap-2", compact ? "mt-3" : "mt-5 justify-center")}>
      {paused ? (
        // Distinct keys: swapping in place would animate the colors through an unreadable mix.
        <Button key="resume" size={compact ? "sm" : "md"} variant="primary" disabled={busy} onClick={onResume} className={cn(compact && "flex-1")}>
          <Play aria-hidden="true" />
          Resume
        </Button>
      ) : (
        <Button key="pause" size={compact ? "sm" : "md"} disabled={busy} onClick={onPause} className={cn(compact && "flex-1")}>
          <Pause aria-hidden="true" />
          Pause
        </Button>
      )}
      <Button size={compact ? "sm" : "md"} disabled={busy} onClick={() => onExtend(EXTEND_MINUTES)} className={cn(compact && "flex-1")}>
        +{EXTEND_MINUTES} min
      </Button>
      <Button size={compact ? "sm" : "md"} variant="ghost" disabled={busy} onClick={onEnd} className={cn(compact && "flex-1")}>
        End
      </Button>
    </div>
  );
  const observedNote = session.kind === "focus" && !paused && session.current === null && (
    <p className={cn("text-xs text-muted-foreground", compact ? "mt-2" : "mt-3 text-center")}>
      Nothing is being tracked right now, so drift alerts are paused. The countdown keeps going.
    </p>
  );
  const drift = session.alerting && (
    <DriftCard
      app={session.alerting}
      intent={session.intent}
      busy={busy}
      onAllowApp={onAllowApp}
      onBackToIt={onBackToIt}
      onEnd={onEnd}
    />
  );
  const failure = error && (
    <p role="alert" className="mt-2 text-xs text-destructive">
      {error}
    </p>
  );

  if (compact) {
    return (
      <section aria-label="Active timer" className="rounded-xl border border-border bg-surface p-3">
        <div className="flex items-center gap-4">
          <TimerRing progress={done} kind={session.kind} paused={paused} size={96} stroke={5}>
            {countdown}
          </TimerRing>
          <div className="min-w-0 flex-1 space-y-1.5">
            <ModeLabel session={session} />
            <p className={cn("truncate font-medium", !task && "text-muted-foreground")} title={task || undefined}>
              {task || (session.kind === "break" ? "Step away for a moment" : "Untitled block")}
            </p>
            <RoundDots cycle={cycle} />
          </div>
        </div>
        {drift || controls}
        {observedNote}
        {failure}
      </section>
    );
  }

  return (
    <section aria-label="Active timer" className="rounded-xl border border-border bg-surface px-6 py-6">
      <div className="flex flex-col items-center text-center">
        <TimerRing progress={done} kind={session.kind} paused={paused} size={208} stroke={8}>
          <ModeLabel session={session} />
          {countdown}
          <p className="text-xs text-muted-foreground tabular">of {Math.round(session.planned_ms / 60_000)} min</p>
        </TimerRing>
        <p
          className={cn("mt-4 max-w-full truncate text-lg font-semibold", !task && "text-muted-foreground font-medium")}
          title={task || undefined}
        >
          {task || (session.kind === "break" ? "Step away for a moment" : "Untitled block")}
        </p>
        <RoundDots cycle={cycle} className="mt-2" />
        {session.kind === "focus" && (
          <p className="mt-2 text-xs text-muted-foreground">
            Allowed: {allowedSummary(session.allowed)}
            {session.drift_alerts > 0 && ` · ${session.drift_alerts === 1 ? "1 alert" : `${session.drift_alerts} alerts`} so far`}
          </p>
        )}
      </div>
      {drift ? <div className="mx-auto max-w-md">{drift}</div> : controls}
      {observedNote}
      {failure}
    </section>
  );
}
