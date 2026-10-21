#!/usr/bin/env node
/**
 * Generates the static Open Graph / Twitter card image at `public/og.png` (1200x630).
 *
 * It composes the app icon, a headline and the light Today screenshot with sharp (already
 * installed as Astro's image service). Re-run after `npm run screenshots` or copy changes:
 *   npm run og
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const WIDTH = 1200;
const HEIGHT = 630;

const icon = await sharp(resolve(root, "src/assets/brand/app-icon.png")).resize(88, 88).png().toBuffer();

// Screenshot card: the top of the Today view, with rounded corners and a hairline border.
const SHOT_W = 620;
const SHOT_H = 430;
const RADIUS = 18;
const shot = await sharp(resolve(root, "src/assets/screenshots/today-light.png"))
  .resize(SHOT_W, SHOT_H, { fit: "cover", position: "left top" })
  .composite([
    {
      input: Buffer.from(
        `<svg width="${SHOT_W}" height="${SHOT_H}"><rect width="${SHOT_W}" height="${SHOT_H}" rx="${RADIUS}" fill="#fff"/></svg>`,
      ),
      blend: "dest-in",
    },
  ])
  .png()
  .toBuffer();

const FONT = "-apple-system, 'SF Pro Display', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const background = `
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#f5f5f7"/>
  <text x="72" y="250" font-family="${FONT}" font-size="60" font-weight="700" fill="#1d1d1f" letter-spacing="-1.5">See where your</text>
  <text x="72" y="320" font-family="${FONT}" font-size="60" font-weight="700" fill="#1d1d1f" letter-spacing="-1.5">day actually goes.</text>
  <text x="72" y="388" font-family="${FONT}" font-size="26" fill="#57575c">A private time tracker for your menu bar.</text>
  <text x="72" y="428" font-family="${FONT}" font-size="26" fill="#57575c">Free, open source and fully local.</text>
  <text x="168" y="148" font-family="${FONT}" font-size="34" font-weight="600" fill="#1d1d1f">TimeTrack</text>
  <rect x="${WIDTH - SHOT_W + 59}" y="${(HEIGHT - SHOT_H) / 2 + 49}" width="${SHOT_W + 2}" height="${SHOT_H + 2}" rx="${RADIUS + 1}" fill="#e3e3e8"/>
</svg>`;

await sharp(Buffer.from(background))
  .composite([
    { input: icon, left: 64, top: 92 },
    { input: shot, left: WIDTH - SHOT_W + 60, top: (HEIGHT - SHOT_H) / 2 + 50 },
  ])
  .png({ compressionLevel: 9 })
  .toFile(resolve(root, "public/og.png"));

const { size } = await readFile(resolve(root, "public/og.png")).then((b) => ({ size: b.length }));
console.log(`saved public/og.png (${Math.round(size / 1024)} KB)`);
