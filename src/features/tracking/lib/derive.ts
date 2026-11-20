import type { AppTotalDto, DegradedReasonDto, FocusDto, OsDto, TrackingStateDto } from "@/shared/ipc";
import type { Messages } from "@/shared/i18n";
import { platformWords } from "@/shared/lib/platform";

/** Pure view-model helpers for the popover (no IPC, no clock). */

/** True while the backend is accruing time into an open segment. */
export function isAccruing(state: TrackingStateDto | undefined): boolean {
  return state === "running";
}

/**
 * Milliseconds that passed since the report was fetched. The report already includes the
 * open segment up to the fetch, so only this delta is added on the client (no IPC per second).
 */
export function elapsedSinceFetch(fetchedAt: number, now: number, accruing: boolean): number {
  return accruing ? Math.max(0, now - fetchedAt) : 0;
}

export interface TopAppRow {
  key: string;
  name: string;
  totalMs: number;
  /** 0..1 relative to the largest row, used for the bar. */
  share: number;
}

/** Top apps of the day with the live delta applied to the app in the foreground. */
export function buildTopApps(
  byApp: readonly AppTotalDto[],
  current: FocusDto | null,
  elapsedMs: number,
  limit: number,
): TopAppRow[] {
  const rows = byApp.map((app) => ({
    key: app.app_id ?? "manual",
    name: app.app_name,
    totalMs: app.total_ms,
  }));
  if (current && elapsedMs > 0) {
    const live = rows.find((row) => row.key === current.app_id);
    if (live) live.totalMs += elapsedMs;
    else rows.push({ key: current.app_id, name: current.app_name, totalMs: elapsedMs });
  }
  const top = rows.sort((a, b) => b.totalMs - a.totalMs).slice(0, limit);
  const max = top[0]?.totalMs ?? 0;
  return top.map((row) => ({ ...row, share: max > 0 ? row.totalMs / max : 0 }));
}

export type ToggleCommand = "start" | "pause" | "resume";

export interface ToggleAction {
  command: ToggleCommand;
  label: string;
}

/** What the main button does in each state; `null` while idle or asleep (design section 4). */
export function toggleAction(state: TrackingStateDto, t: Messages): ToggleAction | null {
  switch (state) {
    case "running":
      return { command: "pause", label: t.tracking.toggle.pause };
    case "paused":
      return { command: "resume", label: t.tracking.toggle.resume };
    case "stopped":
      return { command: "start", label: t.tracking.toggle.start };
    case "idle":
    case "asleep":
      return null;
  }
}

/** Status line while tracking is degraded; a missing reason means macOS Accessibility. */
export function degradedLabel(reason: DegradedReasonDto | null | undefined, t: Messages): string {
  return (reason ?? "accessibility_denied") === "accessibility_denied"
    ? t.tracking.degradedStatus.titlesOff
    : t.tracking.degradedStatus.windowsUnavailable;
}

export function stateLabel(state: TrackingStateDto, t: Messages): string {
  return t.tracking.states[state];
}

/** Short explanation shown when there is no app in the foreground to report. */
export function emptyActivityText(state: TrackingStateDto, t: Messages, os: OsDto = "macos"): string {
  return state === "asleep" ? t.tracking.empty.asleep(platformWords(os, t).Device) : t.tracking.empty[state];
}
