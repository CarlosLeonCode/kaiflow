#!/usr/bin/env node
/**
 * Captures real screenshots of the TimeTrack UI for the website.
 *
 * It starts the app's Vite dev server in `mock` mode (in-memory backend, seeded data) from
 * the repository root, opens each window with Playwright at 2x, and writes light and dark
 * PNGs to `website/src/assets/screenshots/`. Re-run it whenever the app UI changes.
 *
 * Requirements: the app's dependencies installed at the repo root (`npm install` there),
 * which provide Vite and Playwright, plus a Chromium build (`npx playwright install chromium`).
 *
 * Usage (from `website/`):
 *   npm run screenshots
 *   BASE_URL=http://localhost:1430 npm run screenshots   # reuse a server you already started
 *
 * The mock server uses port 1430 so it never collides with `npm run dev` (1420) or the e2e
 * suite (1421).
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const outDir = resolve(here, "../src/assets/screenshots");
const PORT = 1430;
const baseUrl = process.env.BASE_URL ?? `http://localhost:${PORT}`;

/** Fixed instant (Wednesday afternoon) so "today" and the seeded history look the same every run. */
const NOW = new Date("2026-03-18T14:00:00+01:00");

/**
 * Popover and main window sizes match the real app windows. Query flags pick mock scenarios
 * (see `src/dev/index.ts`): demo goals with streaks, and a running focus session.
 */
const MAIN = { width: 1040, height: 720 };
const SHOTS = [
  { name: "popover", path: "/popover.html", viewport: { width: 360, height: 480 }, skipIdle: true },
  { name: "today", path: "/main.html?goals=demo", section: "Today", viewport: MAIN },
  { name: "overview", path: "/main.html?goals=demo", section: "Overview", viewport: MAIN },
  { name: "goals", path: "/main.html?goals=demo", section: "Goals", viewport: MAIN },
  { name: "focus", path: "/main.html?focus=running", section: "Focus", viewport: MAIN },
];
const SCHEMES = ["light", "dark"];

// Playwright comes from the app's own devDependencies so the website stays lean.
const requireFromRoot = createRequire(resolve(repoRoot, "package.json"));
let chromium;
try {
  ({ chromium } = requireFromRoot("@playwright/test"));
} catch {
  console.error("Playwright not found. Run `npm install` at the repository root first.");
  process.exit(1);
}

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`Mock server did not answer at ${url} within ${timeoutMs / 1000}s`);
}

function startMockServer() {
  const server = spawn("npx", ["vite", "--mode", "mock", "--port", String(PORT), "--strictPort"], {
    cwd: repoRoot,
    stdio: ["ignore", "ignore", "inherit"],
    detached: process.platform !== "win32",
  });
  const stop = () => {
    if (server.exitCode !== null) return;
    try {
      // Kill the whole process group (npx spawns vite as a child).
      if (process.platform === "win32") server.kill();
      else process.kill(-server.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  };
  return stop;
}

/** Hides first-run section intros so screenshots show the actual content. */
async function dismissIntros(page) {
  for (let i = 0; i < 5; i += 1) {
    const dismiss = page.getByRole("button", { name: /^Dismiss introduction/ }).first();
    if (!(await dismiss.isVisible().catch(() => false))) return;
    await dismiss.click();
  }
}

async function capture(browser) {
  await mkdir(outDir, { recursive: true });
  for (const scheme of SCHEMES) {
    for (const shot of SHOTS) {
      const context = await browser.newContext({
        viewport: shot.viewport,
        deviceScaleFactor: 2,
        colorScheme: scheme,
        reducedMotion: "reduce",
        locale: "en-US",
        timezoneId: "Europe/Madrid",
      });
      const page = await context.newPage();
      await page.clock.setFixedTime(NOW);
      await page.goto(`${baseUrl}${shot.path}`);
      await page.waitForLoadState("networkidle");
      if (shot.section) {
        await page
          .getByRole("navigation", { name: "Sections" })
          .getByRole("button", { name: new RegExp(`^${shot.section}`) })
          .click();
        await page.getByRole("main").getByRole("heading", { level: 1, name: shot.section }).waitFor();
      }
      await dismissIntros(page);
      if (shot.skipIdle) {
        // The seeded idle prompt hides the popover's main content; answer it like a user would.
        const discard = page.getByRole("button", { name: "Discard", exact: true });
        if (await discard.isVisible().catch(() => false)) await discard.click();
      }
      // Let charts settle after layout changes.
      await page.waitForTimeout(400);
      const file = resolve(outDir, `${shot.name}-${scheme}.png`);
      await page.screenshot({ path: file, animations: "disabled", caret: "hide" });
      console.log(`saved ${file.replace(`${repoRoot}/`, "")}`);
      await context.close();
    }
  }
}

const stopServer = process.env.BASE_URL ? () => {} : startMockServer();
process.on("SIGINT", () => {
  stopServer();
  process.exit(130);
});

try {
  await waitForServer(`${baseUrl}/main.html`);
  const browser = await chromium.launch();
  try {
    await capture(browser);
  } finally {
    await browser.close();
  }
} finally {
  stopServer();
}
