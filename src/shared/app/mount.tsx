import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";

import "@/index.css";
import { applyTheme } from "@/shared/lib/theme";

import { AppProviders } from "./AppProviders";

/** Entry helper shared by every window: theme first (no flash), then providers + page. */
export function mountWindow(page: ReactNode): void {
  applyTheme("system");
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root element");
  createRoot(root).render(<AppProviders>{page}</AppProviders>);
}
