import { installMockBackend } from "./mockBackend";

/**
 * Installs the mocked backend. Query flags tweak the scenario so one dev server covers the
 * states that are hard to reach otherwise:
 * - `?permission=denied`: Accessibility revoked (onboarding, degraded banner).
 * - `?update=1`: an update is announced at startup (popover banner, Settings panel).
 * - `?update=manual`: an update is only offered when "Check now" is pressed.
 * - `?data=empty`: no tracked time at all (empty states).
 * - `?goals=demo`: four goals with progress, an exceeded limit and streaks.
 * - `?focus=running`: a focus session is running with the app in front on target;
 *   `?focus=drift` has the drift alert already showing.
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
    permission: params.get("permission") === "denied" ? "denied" : "granted",
    emptyActivities: params.get("activities") === "empty",
    emptyHistory: params.get("data") === "empty",
    demoGoals: params.get("goals") === "demo",
    demoFocus: params.get("focus") === "drift" ? "drift" : params.get("focus") === "running" ? "running" : undefined,
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
