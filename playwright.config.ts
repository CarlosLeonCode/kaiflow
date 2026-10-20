import { defineConfig, devices } from "@playwright/test";

const PORT = 1421;

// E2E runs the real windows against the Vite dev server in `mock` mode (in-memory backend,
// see src/dev). Port 1421 keeps it clear of `npm run dev` / `tauri dev` on 1420.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Fixed locale and zone so formatted times and day boundaries are stable everywhere.
    locale: "en-US",
    timezoneId: "Europe/Madrid",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx vite --mode mock --port ${PORT}`,
    url: `http://localhost:${PORT}/main.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
