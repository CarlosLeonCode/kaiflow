import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";

import "@/index.css";
import { applyTheme } from "@/shared/lib/theme";

import { AppProviders } from "./AppProviders";

/**
 * Dev-only: serves the windows from an in-memory backend (`npm run dev:mock`, Playwright).
 * `VITE_MOCK_IPC` only exists in the `mock` mode; in every other build the condition folds to
 * `false` and the dynamic import, with the whole `src/dev` tree, is dropped (vite.config.ts
 * also fails a production build that sets the flag).
 */
async function installMockBackendIfRequested(): Promise<void> {
  if (import.meta.env.VITE_MOCK_IPC === "1") {
    const { installMockIpc } = await import("@/dev");
    installMockIpc();
  }
}

/** Entry helper shared by every window: theme first (no flash), then providers + page. */
export function mountWindow(page: ReactNode): void {
  applyTheme("system");
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root element");
  void installMockBackendIfRequested().then(() => {
    createRoot(root).render(<AppProviders>{page}</AppProviders>);
  });
}
