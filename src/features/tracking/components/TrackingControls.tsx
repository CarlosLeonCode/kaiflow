import { LayoutDashboard, Pause, Play } from "lucide-react";

import type { TrackingStateDto } from "@/shared/ipc";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Kbd } from "@/shared/ui/kbd";

import { stateLabel, toggleAction, type ToggleCommand } from "../lib/derive";

export function StatusHeader({ state }: { state: TrackingStateDto }) {
  const dot = {
    running: "bg-success",
    paused: "bg-warning-foreground",
    stopped: "bg-muted-foreground/50",
    idle: "bg-muted-foreground/50",
    asleep: "bg-muted-foreground/50",
  }[state];
  return (
    <div className="flex items-center gap-2" role="status" aria-label={`Status: ${stateLabel(state)}`}>
      <span className="relative flex size-2">
        {state === "running" && (
          <span className="absolute inline-flex size-full rounded-full bg-success opacity-60 motion-safe:animate-ping" />
        )}
        <span className={cn("relative inline-flex size-2 rounded-full", dot)} />
      </span>
      <span className="font-medium">{stateLabel(state)}</span>
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
  const action = toggleAction(state);
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
          Pause tracking
        </Button>
      )}
      {shortcut && <Kbd title="Global shortcut">{shortcut}</Kbd>}
      <Button variant="ghost" className="ml-auto" onClick={onOpenDashboard}>
        <LayoutDashboard aria-hidden="true" />
        Open dashboard
      </Button>
    </footer>
  );
}
