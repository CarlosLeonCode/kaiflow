import type { OsDto, PlatformInfoDto } from "@/shared/ipc";

import { installMockBackend, type DemoFocus } from "./mockBackend";

const DEMO_FOCUS: readonly DemoFocus[] = ["running", "drift", "break", "paused", "ended"];

function demoFocus(value: string | null): DemoFocus | undefined {
  return DEMO_FOCUS.find((demo) => demo === value);
}

const OSES: readonly OsDto[] = ["macos", "windows", "linux"];

/** `?os=windows|linux|macos`, plus `&session=wayland|x11` on Linux (X11 when omitted). */
function mockPlatform(params: URLSearchParams): PlatformInfoDto {
  const os = OSES.find((candidate) => candidate === params.get("os")) ?? "macos";
  return {
    os,
    session: os === "linux" ? (params.get("session") === "wayland" ? "wayland" : "x11") : null,
    needs_accessibility_permission: os === "macos",
  };
}

/**
 * Installs the mocked backend. Query flags tweak the scenario so one dev server covers the
 * states that are hard to reach otherwise:
 * - `?permission=denied`: Accessibility revoked (onboarding, degraded banner; macOS only).
 * - `?os=windows` / `?os=linux` (`&session=wayland` for a Wayland session): platform copy,
 *   onboarding without the Accessibility step and the Ctrl+Alt+Shift+K default shortcut.
 * - `?update=1`: an update is announced at startup (popover banner, Settings panel).
 * - `?update=manual`: an update is only offered when "Check now" is pressed.
 * - `?data=empty`: no tracked time at all (empty states).
 * - `?goals=demo`: four goals with progress, an exceeded limit and streaks.
 * - `?focus=running`: a focus block is running with the app in front on target;
 *   `?focus=drift` has the drift alert already showing, `?focus=break` runs a short break,
 *   `?focus=paused` holds a paused timer and `?focus=ended` shows the end card.
 * - `?backup=failing`: the daily backup cannot write (Settings > Data error state).
 * - `?ai=on`: the Ollama provider is already switched on (Review can analyze right away);
 *   `?ai=offline` makes every analysis fail as if the network were down.
 * - `?keychain=missing`: the OS has no secure key store (keys are refused, like Linux without
 *   a Secret Service).
 * - `?activities=empty`: only the system activity and no rules (first-run preset choice).
 */
export function installMockIpc(search: string = window.location.search): void {
  const params = new URLSearchParams(search);
  installMockBackend({
    platform: mockPlatform(params),
    permission: params.get("permission") === "denied" ? "denied" : "granted",
    emptyActivities: params.get("activities") === "empty",
    emptyHistory: params.get("data") === "empty",
    demoGoals: params.get("goals") === "demo",
    demoFocus: demoFocus(params.get("focus")),
    backupFails: params.get("backup") === "failing",
    aiOn: params.get("ai") === "on" || params.get("ai") === "offline",
    aiOffline: params.get("ai") === "offline",
    keychainMissing: params.get("keychain") === "missing",
    announceUpdate: params.get("update") === "1",
    update: ["1", "manual"].includes(params.get("update") ?? "")
        ? { version: "0.2.0", current_version: "0.1.0", notes: "Faster history.\nFixes the idle prompt.", date: null }
        : null,
  });
}
