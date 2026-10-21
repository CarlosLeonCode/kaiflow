import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/** App version shown in Settings > About; package.json is bumped with tauri.conf.json. */
const APP_VERSION = (JSON.parse(readFileSync(resolve(import.meta.dirname, "package.json"), "utf8")) as { version: string })
  .version;

// One HTML entry per Tauri window so the popover never loads the dashboard bundle.
export default defineConfig(({ mode }) => {
  // The in-memory dev backend (`mock` mode) must never reach a shipped bundle.
  if (mode === "production" && loadEnv(mode, process.cwd(), "VITE_").VITE_MOCK_IPC) {
    throw new Error("VITE_MOCK_IPC is dev-only: remove it from the production build environment.");
  }
  return {
    plugins: [react(), tailwindcss()],
    define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
    resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
    clearScreen: false,
    server: { port: 1420, strictPort: true },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      target: "safari16",
      rollupOptions: {
        input: {
          popover: resolve(import.meta.dirname, "popover.html"),
          main: resolve(import.meta.dirname, "main.html"),
          onboarding: resolve(import.meta.dirname, "onboarding.html"),
        },
      },
    },
  };
});
