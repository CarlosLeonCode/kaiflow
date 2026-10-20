/**
 * Category colors are user data (any hex). A pale yellow vanishes on a white card and a deep
 * navy vanishes on the dark background, so every color is tuned per theme before it is
 * painted: the hue stays, the lightness is clamped to a band that stays visible.
 */

const FALLBACK = { light: "#6b7280", dark: "#9ca3af" } as const;

/** Lightness bands (0..1) that read well on the light and dark surfaces. */
const BAND = { light: { min: 0.3, max: 0.5 }, dark: { min: 0.6, max: 0.78 } } as const;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** `#rgb` or `#rrggbb` (case-insensitive); anything else is `null`. */
export function parseHex(value: string): Rgb | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  const digits = match?.[1];
  if (!digits) return null;
  const full =
    digits.length === 3
      ? Array.from(digits)
          .map((c) => c + c)
          .join("")
      : digits;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Returns `[hue 0..360, saturation 0..1, lightness 0..1]`. */
export function rgbToHsl({ r, g, b }: Rgb): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return [0, 0, l];
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / delta) % 6;
  else if (max === gn) h = (bn - rn) / delta + 2;
  else h = (rn - gn) / delta + 4;
  return [(h * 60 + 360) % 360, s, l];
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const sector = Math.floor(h / 60) % 6;
  const [r1, g1, b1] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector] as [number, number, number];
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

/** The category color adjusted so it stays visible in the given theme. */
export function tuneCategoryColor(value: string, dark: boolean): string {
  const theme = dark ? "dark" : "light";
  const rgb = parseHex(value);
  if (!rgb) return FALLBACK[theme];
  const [h, s, l] = rgbToHsl(rgb);
  const band = BAND[theme];
  const lightness = Math.min(band.max, Math.max(band.min, l));
  return toHex(hslToRgb(h, Math.min(s, 0.85), lightness));
}
