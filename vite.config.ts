import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// One HTML entry per Tauri window so the popover never loads the dashboard bundle.
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
});
