import { LayoutDashboard, Pause, Play } from "lucide-react";

import { useT } from "@/shared/i18n";
import type { TrackingStateDto } from "@/shared/ipc";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Kbd } from "@/shared/ui/kbd";

import { stateLabel, toggleAction, type ToggleCommand } from "../lib/derive";

export function StatusHeader({ state }: { state: TrackingStateDto }) {
  const t = useT();
  const label = stateLabel(state, t);
  const dot = {
    running: "bg-success",
    paused: "bg-warning-foreground",
    stopped: "bg-muted-foreground/50",
    idle: "bg-muted-foreground/50",
    asleep: "bg-muted-foreground/50",
  }[state];
  return (
    <div className="flex items-center gap-2" role="status" aria-label={t.tracking.status(label)}>
      <span className="relative flex size-2">
        {state === "running" && (
          <span className="absolute inline-flex size-full rounded-full bg-success opacity-60 motion-safe:animate-ping" />
        )}
        <span className={cn("relative inline-flex size-2 rounded-full", dot)} />
      </span>
      <span className="font-medium">{label}</span>
    </div>
  );
}

interface FooterProps {
  state: TrackingStateDto;
  shortcut: string | null;
  pending: boolean;
  onToggle: (command: ToggleCommand) => void;
  onOpenDashboard: () => void;
}

/** Primary pause/resume/start action plus the way into the dashboard. */
export function TrackingFooter({ state, shortcut, pending, onToggle, onOpenDashboard }: FooterProps) {
  const t = useT();
  const action = toggleAction(state, t);
  return (
    <footer className="flex items-center gap-2 border-t border-border bg-surface px-4 py-2.5">
      {action ? (
        <Button
          variant="primary"
          disabled={pending}
          onClick={() => onToggle(action.command)}
        >
          {action.command === "pause" ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          {action.label}
        </Button>
      ) : (
        <Button variant="secondary" disabled>
          <Pause aria-hidden="true" />
          {t.tracking.toggle.pause}
        </Button>
      )}
      {shortcut && <Kbd title={t.tracking.globalShortcut}>{shortcut}</Kbd>}
      <Button variant="ghost" className="ml-auto" onClick={onOpenDashboard}>
        <LayoutDashboard aria-hidden="true" />
        {t.tracking.openDashboard}
      </Button>
    </footer>
  );
}
