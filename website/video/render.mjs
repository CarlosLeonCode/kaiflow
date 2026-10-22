#!/usr/bin/env node
/**
 * Renders the Kaiflow explainer (index.html) to video.
 *
 * Each frame is set with `window.__seek(t)` and captured with Playwright at 1920x1080. PNG
 * frames are piped straight into ffmpeg (no frames on disk), which writes an H.264 MP4 and a
 * VP9 WebM in one pass. A poster JPG is captured from a key frame.
 *
 * Requirements: the app's dependencies at the repo root (`npm install`, provides Playwright and
 * its Chromium) and ffmpeg with libx264 and libvpx-vp9 on PATH (or FFMPEG=/path/to/ffmpeg).
 *
 * Usage (from the repo root):
 *   node website/video/render.mjs --out /some/dir             # kaiflow-explainer.{mp4,webm,jpg}
 *   node website/video/render.mjs --out /some/dir --contact   # 12-frame contact sheet only
 *   node website/video/render.mjs --out /some/dir --ranges 9.4-11.6,14.4-16 --scale 0.5 --name preview
 * Options: --times 1,2.5,9 (contact sheet moments, up to 12), --fps 30, --crf 24 (H.264), --vp9-crf 32, --poster 31.2 (seconds), --name kaiflow-explainer
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const OUT = resolve(opt("out", join(here, "out")));
const NAME = opt("name", "kaiflow-explainer");
const FPS = Number(opt("fps", 30));
const CRF = opt("crf", "24");
const VP9_CRF = opt("vp9-crf", "32");
const POSTER_T = Number(opt("poster", 31.2));
const RANGES = opt("ranges", ""); // preview: "9.4-11.6,14.4-16" renders only those spans
const SCALE = Number(opt("scale", 1)); // preview: 0.5 renders 960x540
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const W = 1920, H = 1080;

const { chromium } = createRequire(resolve(repoRoot, "package.json"))("@playwright/test");

function run(cmd, argv, { input } = {}) {
  const child = spawn(cmd, argv, { stdio: [input ? "pipe" : "ignore", "inherit", "inherit"] });
  const done = new Promise((ok, fail) => child.on("exit", (code) => (code === 0 ? ok() : fail(new Error(`${cmd} exited with ${code}`)))));
  return { child, done };
}

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE });
  await page.goto(`${pathToFileURL(join(here, "index.html")).href}?render`);
  await page.evaluate(() => window.__ready);
  return page;
}
const shoot = async (page, t, extra = {}) => {
  await page.evaluate((x) => window.__seek(x), t);
  return page.screenshot({ type: "png", ...extra });
};

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await openPage(browser);
  const duration = await page.evaluate(() => window.__DURATION);

  if (flag("contact")) {
    // 12 evenly spread frames, tiled 4x3 for a quick visual review.
    const tmp = await mkdtemp(join(OUT, ".contact-"));
    const custom = opt("times", "");
    const times = custom
      ? custom.split(",").map(Number).slice(0, 12)
      : Array.from({ length: 12 }, (_, i) => 0.9 + (i * (duration - 1.8)) / 11);
    for (const [i, t] of times.entries()) await shoot(page, t, { path: join(tmp, `f${String(i).padStart(2, "0")}.png`) });
    const sheet = join(OUT, `${NAME}-contact.jpg`);
    await run(FFMPEG, ["-y", "-loglevel", "error", "-i", join(tmp, "f%02d.png"), "-vf", "scale=640:-1,tile=4x3:padding=8:margin=8:color=0xcfc8bb", "-frames:v", "1", "-q:v", "3", sheet]).done;
    await rm(tmp, { recursive: true, force: true });
    console.log(`contact sheet: ${sheet} (t = ${times.map((t) => t.toFixed(1)).join(", ")})`);
  } else if (RANGES) {
    // Low-res preview of chosen spans, back to back, MP4 only.
    const times = RANGES.split(",").flatMap((r) => {
      const [a, b] = r.split("-").map(Number);
      return Array.from({ length: Math.round((b - a) * FPS) }, (_, i) => a + i / FPS);
    });
    const mp4 = join(OUT, `${NAME}.mp4`);
    const ff = run(FFMPEG, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
      "-c:v", "libx264", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4], { input: true });
    for (const t of times) {
      const png = await shoot(page, t);
      if (!ff.child.stdin.write(png)) await new Promise((r) => ff.child.stdin.once("drain", r));
    }
    ff.child.stdin.end();
    await ff.done;
    console.log(`preview: ${mp4} (${times.length} frames)`);
  } else {
    const frames = Math.round(duration * FPS);
    const mp4 = join(OUT, `${NAME}.mp4`), webm = join(OUT, `${NAME}.webm`);
    const ff = run(FFMPEG, [
      "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
      // H.264 for everything, yuv420p for Safari/QuickTime, moov atom first for streaming.
      "-map", "0", "-c:v", "libx264", "-preset", "slow", "-crf", CRF, "-tune", "animation", "-pix_fmt", "yuv420p",
      "-movflags", "+faststart", "-an", mp4,
      // VP9 for browsers that prefer WebM.
      "-map", "0", "-c:v", "libvpx-vp9", "-crf", VP9_CRF, "-b:v", "0", "-row-mt", "1", "-deadline", "good",
      "-cpu-used", "2", "-pix_fmt", "yuv420p", "-an", webm,
    ], { input: true });
    const started = Date.now();
    for (let f = 0; f < frames; f += 1) {
      const png = await shoot(page, f / FPS);
      if (!ff.child.stdin.write(png)) await new Promise((r) => ff.child.stdin.once("drain", r));
      if (f % 60 === 0) process.stdout.write(`frame ${f}/${frames}\r`);
    }
    ff.child.stdin.end();
    await ff.done;
    await page.evaluate((x) => window.__seek(x), POSTER_T);
    await page.screenshot({ type: "jpeg", quality: 88, path: join(OUT, `${NAME}.jpg`) });
    console.log(`\n${frames} frames in ${((Date.now() - started) / 1000).toFixed(0)}s -> ${mp4}, ${webm}, ${NAME}.jpg`);
  }
} finally {
  await browser.close();
}
