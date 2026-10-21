import type { ReactNode } from "react";

import { GoalsMini } from "@/features/goals/components/GoalsMini";
import type { DegradedReasonDto, FocusDto, GoalStatusDto, ShortcutStatusDto, TrackingStateDto } from "@/shared/ipc";

import type { ToggleCommand, TopAppRow } from "../lib/derive";
import { CurrentActivity } from "./CurrentActivity";
import { DegradedBanner, ShortcutBanner } from "./StatusBanners";
import { TodayTotal } from "./TodayTotal";
import { TopApps } from "./TopApps";
import { StatusHeader, TrackingFooter } from "./TrackingControls";

export interface TrackingPopoverProps {
  state: TrackingStateDto;
  degraded: boolean;
  /** Why tracking is degraded; `null` falls back to the Accessibility explanation. */
  degradedReason?: DegradedReasonDto | null;
  shortcut: ShortcutStatusDto;
  current: FocusDto | null;
  currentElapsedMs: number | null;
  /** Today's total including the live delta; `undefined` while the first report loads. */
  totalMs: number | undefined;
  topApps: TopAppRow[];
  topAppsLoading: boolean;
  /** Progress of the goals; the popover shows the two most relevant. */
  goals?: readonly GoalStatusDto[];
  togglePending: boolean;
  /** Slot above the totals, used for the idle-return card. */
  notice?: ReactNode;
  onToggle: (command: ToggleCommand) => void;
  onOpenDashboard: () => void;
  onOpenAccessibilitySettings: () => void;
}

/** Pure view of the menu-bar popover: everything arrives as props, nothing touches IPC. */
export function TrackingPopover(props: TrackingPopoverProps) {
  const { shortcut } = props;
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-10 shrink-0 items-center border-b border-border px-4">
        <StatusHeader state={props.state} />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        <div className="space-y-2 px-4 pt-3 empty:hidden">
          {props.degraded && (
            <DegradedBanner reason={props.degradedReason} onOpenSettings={props.onOpenAccessibilitySettings} />
          )}
          {shortcut.kind === "unavailable" && (
            <ShortcutBanner shortcut={shortcut.shortcut} reason={shortcut.reason} />
          )}
          {props.notice}
        </div>
        <TodayTotal totalMs={props.totalMs} live={props.state === "running"} />
        <CurrentActivity state={props.state} current={props.current} elapsedMs={props.currentElapsedMs} />
        <div className="mt-4">
          <TopApps rows={props.topApps} loading={props.topAppsLoading} />
        </div>
        <GoalsMini goals={props.goals ?? []} />
      </div>

      <TrackingFooter
        state={props.state}
        shortcut={shortcut.kind === "registered" ? shortcut.shortcut : null}
        pending={props.togglePending}
        onToggle={props.onToggle}
        onOpenDashboard={props.onOpenDashboard}
      />
    </div>
  );
}
