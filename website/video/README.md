# Kaiflow explainer video

A silent, 34 s explainer (1920x1080, 30 fps) for the landing page, in a sumi-e style: washi
paper, sumi ink, one vermilion accent, serif statements, English copy only. It is one
continuous shot that loops seamlessly, authored as one HTML page and rendered frame by frame.

| File | What it is |
|---|---|
| `index.html` | The whole film. Brand SVGs are inlined; paper, grain, specks and ink are generated from fixed seeds. No network, no external files. |
| `render.mjs` | Captures frames with Playwright and pipes them into ffmpeg (MP4 + WebM + poster JPG), plus contact sheets and low-res previews. |

## How it works

- **Deterministic.** Every frame is a pure function of time: `window.__seek(t)` sets the
  whole stage (no CSS animations or timers); `window.__DURATION` is the length. Open
  `index.html` in a browser to preview it in a loop; `?t=12.5` freezes one moment.
- **One world, one camera.** All ink lives in one world space. A virtual camera (cubic
  Hermite spline over keyframes `K`, zoom interpolated in log space) dollies, pans and tilts
  through it. The paper moves at 0.1x (background parallax), ink specks and fibers at ~1.3x
  (foreground). Fast camera moves get a subtle directional blur from the camera velocity.
- **One through-line.** A single vermilion drop (the ensō's dot) travels through the whole
  film. The ink morphs between forms by interpolating points and brush outlines (`brush()`
  builds a stroke outline from a centerline and per-point widths).
- **Ink.** Strokes draw with a pressure ramp, a lighter wet tip that darkens as it dries, a
  feathered bleed edge, dry-brush streaks, and splatter on key hits. Key landings use an
  anticipation-and-overshoot easing (`eHit`) followed by a decaying tremble.
- **Type.** Statements in the system serif (New York on macOS, then Iowan Old Style,
  Georgia), revealed word by word with a brush-mask sweep and a soft rise, and leaving with
  momentum. Some lines live in the world (they move with the camera), others float on screen
  with a slight camera drift.
- **Finish.** Film grain (one seeded tile, offset every other frame) and a 4% vignette.
- **Loop.** The film opens on an extreme close-up of the vermilion dot and ends by dollying
  back into the same dot at the same framing, so frame 0 follows the last frame.

| Time (s) | Beat | Line | Ink and camera |
|---|---|---|---|
| 0.0-5.6 | The problem | Your day disappears / between apps. | Extreme close-up on the vermilion drop; ink drops land with splatter; pull back as they drift apart |
| 5.0-9.8 | Why Kaiflow | Kaiflow was made / to show you where it goes. | The drops gather; the ensō draws itself and absorbs them; the drop lands in the opening (overshoot, splatter); slow dolly in |
| 9.8-15.5 | What it does | It quietly records / the app in front of you. · Privately, on your computer. | The ensō unrolls into the day's axis; close-up on the brush landing; the camera tracks the day stroke as it paints (app ink tones, vermilion "now") under a floating menu bar |
| 14.6-21.6 | What you can do | Set a goal. / Focus on one thing. | The stroke curls into a focus ring that closes with the countdown (`◔ 25:00 · Write report` in the menu bar); the drop lands in the gap; the ring beads into a 7-day streak |
| 21.6-26.9 | What you get | Improve a little, / every day. | The drop climbs, leaving darker and steadier dots; a thin trend stroke follows; pull back to a wide shot of the whole day |
| 26.9-34.0 | Close | Kaiflow · Free and open source · macOS, Windows & Linux (beta) | Everything gathers into the ensō; the drop lands as its dot; the wordmark and tagline; dolly back into the dot (loop) |

## Re-render

Requirements: the app's dependencies at the repo root (`npm install`; provides Playwright and
its Chromium) and ffmpeg with `libx264` and `libvpx-vp9` (`brew install ffmpeg`). Render on
macOS for the intended serif.

```bash
# From the repo root. Writes kaiflow-explainer.mp4, .webm and .jpg (poster) to --out.
node website/video/render.mjs --out /tmp/kaiflow-video

# Review: a 4x3 contact sheet (evenly spaced, or at chosen moments).
node website/video/render.mjs --out /tmp/kaiflow-video --contact
node website/video/render.mjs --out /tmp/kaiflow-video --contact --times 1,5,10.4,15,21,27.6

# Review: a low-res MP4 of chosen spans, back to back.
node website/video/render.mjs --out /tmp/kaiflow-video --ranges 7-11.8,14.2-16.4,26.2-30.2 --scale 0.5 --name preview
```

Options: `--fps 30`, `--crf 18` (H.264 quality), `--vp9-crf 32`, `--poster 31.2` (poster time
in seconds), `--name kaiflow-explainer`. Set `FFMPEG=/path/to/ffmpeg` if it is not on `PATH`.
A full render takes about 10 to 15 minutes (full-frame textures, grain and blur); frames are
streamed to ffmpeg, so nothing large lands on disk.
