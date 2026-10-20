import { installMockBackend } from "./mockBackend";

/**
 * Installs the mocked backend. Query flags tweak the scenario so one dev server covers the
 * states that are hard to reach otherwise:
 * - `?permission=denied`: Accessibility revoked (onboarding, degraded banner).
 * - `?update=1`: an update is announced at startup (popover banner, Settings panel).
 * - `?update=manual`: an update is only offered when "Check now" is pressed.
 */
export function installMockIpc(search: string = window.location.search): void {
  const params = new URLSearchParams(search);
  installMockBackend({
    permission: params.get("permission") === "denied" ? "denied" : "granted",
    announceUpdate: params.get("update") === "1",
    update: ["1", "manual"].includes(params.get("update") ?? "")
        ? { version: "0.2.0", current_version: "0.1.0", notes: "Faster history.\nFixes the idle prompt.", date: null }
        : null,
  });
}
