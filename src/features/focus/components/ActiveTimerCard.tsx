import { Pause, Play } from "lucide-react";

import { useT } from "@/shared/i18n";
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

/** The task of a block, trimmed (`""` when it has none). */
function task(session: FocusActiveDto): string {
  return session.intent.trim();
}

/** Mode chip: a colored dot (accent for work, green for a break) and the mode name. */
function ModeLabel({ session }: { session: FocusActiveDto }) {
  const t = useT();
  const paused = session.paused_at !== null;
  return (
    <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", session.kind === "break" ? "bg-pop-mint" : "bg-mark-stroke", paused && "opacity-40")}
      />
      {kindLabel(session.kind, t)}
      {paused && <span className="font-medium normal-case tracking-normal">· {t.focus.paused}</span>}
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
  const t = useT();
  const left = remainingMs(session, now);
  const spoken = remainingLabel(left, t);
  const title = task(session) || (session.kind === "break" ? t.focus.stepAway : t.focus.untitled);
  const done = progress(session, now);
  const paused = session.paused_at !== null;
  const hasTask = task(session) !== "";
  const countdown = (
    <p
      role="timer"
      data-testid="focus-countdown"
      aria-label={paused ? t.focus.pausedTimer(spoken) : spoken}
      className={cn(
        "tabular tracking-tight",
        compact ? "font-display text-xl font-extrabold" : "font-display text-display font-extrabold tracking-[-0.03em]",
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
          {t.focus.resume}
        </Button>
      ) : (
        <Button key="pause" size={compact ? "sm" : "md"} disabled={busy} onClick={onPause} className={cn(compact && "flex-1")}>
          <Pause aria-hidden="true" />
          {t.focus.pause}
        </Button>
      )}
      <Button size={compact ? "sm" : "md"} disabled={busy} onClick={() => onExtend(EXTEND_MINUTES)} className={cn(compact && "flex-1")}>
        {t.focus.extend(EXTEND_MINUTES)}
      </Button>
      <Button size={compact ? "sm" : "md"} variant="ghost" disabled={busy} onClick={onEnd} className={cn(compact && "flex-1")}>
        {t.focus.end}
      </Button>
    </div>
  );
  const observedNote = session.kind === "focus" && !paused && session.current === null && (
    <p className={cn("text-xs text-muted-foreground", compact ? "mt-2" : "mt-3 text-center")}>
      {t.focus.notObserved}
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
      <section aria-label={t.focus.activeTimer} className="rounded-2xl bg-paper-surface p-3">
        <div className="flex items-center gap-4">
          <TimerRing progress={done} kind={session.kind} paused={paused} size={96} stroke={5}>
            {countdown}
          </TimerRing>
          <div className="min-w-0 flex-1 space-y-1.5">
            <ModeLabel session={session} />
            <p className={cn("truncate font-medium", !hasTask && "text-muted-foreground")} title={hasTask ? title : undefined}>
              {title}
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
    <section aria-label={t.focus.activeTimer} className="rounded-card bg-paper-surface px-6 py-7">
      <div className="flex flex-col items-center text-center">
        <TimerRing progress={done} kind={session.kind} paused={paused} size={208} stroke={8}>
          <ModeLabel session={session} />
          {countdown}
          <p className="text-xs text-muted-foreground tabular">{t.focus.ofMinutes(Math.round(session.planned_ms / 60_000))}</p>
        </TimerRing>
        <p
          className={cn("mt-4 max-w-full truncate font-display text-xl leading-[1.15] font-extrabold tracking-[-0.02em]", !hasTask && "text-muted-foreground font-bold")}
          title={hasTask ? title : undefined}
        >
          {title}
        </p>
        <RoundDots cycle={cycle} className="mt-2" />
        {session.kind === "focus" && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t.focus.allowed(allowedSummary(session.allowed, t))}
            {session.drift_alerts > 0 && ` · ${t.focus.alertsSoFar(session.drift_alerts)}`}
          </p>
        )}
      </div>
      {drift ? <div className="mx-auto max-w-md">{drift}</div> : controls}
      {observedNote}
      {failure}
    </section>
  );
}
