# Kaiflow brand

The Kaiflow mark is an **ensō**: a Zen circle drawn in one brush stroke. It starts heavy at
the upper right, runs clockwise and thins to a fine point, and stays **open** near the top
right because the day is still in progress. The **vermilion dot** in the opening is the present
moment, the next step.

## Files

| File | Use |
|---|---|
| `kaiflow-mark.svg` | Primary mark, ink + vermilion on a transparent background, for light surfaces. |
| `kaiflow-mark-dark.svg` | The same mark with light ink, for dark surfaces. |
| `kaiflow-mark-mono.svg` | One color (`currentColor`), dot included. A heavier small-size cut for the menu bar, favicons and anything under ~48 px. No dry-brush streaks. |
| `kaiflow-app-icon.svg` | 1024 x 1024 macOS app icon: paper squircle in the 824 x 824 icon grid, ensō at ~62% of the tile. Source for `src-tauri/icons/`. |
| `kaiflow-wordmark.svg` | Mark + "Kaiflow" for light backgrounds. |
| `kaiflow-wordmark-dark.svg` | Mark + "Kaiflow" for dark backgrounds. |

Derived assets: `src-tauri/icons/` (app icons and `tray-template.png`),
`src/shared/ui/kaiflow-mark.tsx` (in-app mark), `website/src/components/Logo.astro`,
`website/public/` favicons and `website/src/assets/brand/app-icon.png`. See the rebrand
checklist in [docs/forking.md](../../docs/forking.md) for how to regenerate them.

## Colors

| Name | Hex | Role |
|---|---|---|
| Ink | `#17140f` | Stroke and wordmark on light backgrounds |
| Paper | `#f4efe6` | App icon background; stroke and wordmark on dark backgrounds |
| Vermilion | `#e0452b` | The dot only. Never recolor it, never use it for the stroke. |

The dry-brush streaks inside the stroke are cut-outs at low opacity (a mask in the
transparent files, paper-colored strokes in the app icon), so they show the background.

## Wordmark

"Kaiflow" set in Inter Medium (SIL Open Font License), letter spacing -0.02 em, converted to
outlines. The mark sits on the left; the cap height is about 40% of the mark height. On the
web, the landing renders the word as live text in the system sans with the same weight and
tracking.

## Clear space and minimum size

- Keep clear space around the mark equal to the **diameter of the dot** x 2 on every side
  (about 13% of the mark width). The wordmark needs the same clear space around its bounds.
- Use `kaiflow-mark-mono.svg` below 48 px. The detailed mark is legible down to about 24 px
  only when the background is plain.
- The macOS menu bar icon is 18 pt (36 x 36 px @2x), black on transparent, as a template image.

## Rules

- The mark **never contains text or characters**: no letters, no kanji or kana, no
  "Kaiflow" inside the circle. Text belongs only in the wordmark, beside the mark.
- Do not close the circle, rotate it, mirror it, outline it, add gradients or shadows, or
  move the dot out of the opening.
- Do not place the ink mark on busy photos or low-contrast colors; use the paper app icon
  instead.
