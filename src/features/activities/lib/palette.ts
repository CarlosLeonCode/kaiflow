import type { Messages } from "@/shared/i18n";

/**
 * Preset activity colors. Raw values are stored; every paint goes through
 * `tuneActivityColor`, so a preset (or a custom color) stays readable in both themes.
 */
export interface Preset {
  /** Key of its display name in `t.activities.colors`. */
  key: keyof Messages["activities"]["colors"];
  hex: string;
}

export const PRESET_COLORS: readonly Preset[] = [
  { key: "blue", hex: "#3b82f6" },
  { key: "indigo", hex: "#6366f1" },
  { key: "violet", hex: "#8b5cf6" },
  { key: "pink", hex: "#ec4899" },
  { key: "red", hex: "#ef4444" },
  { key: "orange", hex: "#f97316" },
  { key: "amber", hex: "#d97706" },
  { key: "green", hex: "#22c55e" },
  { key: "teal", hex: "#14b8a6" },
  { key: "gray", hex: "#6b7280" },
];

export const DEFAULT_COLOR = PRESET_COLORS[0]!.hex;

export function presetFor(hex: string): Preset | undefined {
  return PRESET_COLORS.find((preset) => preset.hex.toLowerCase() === hex.toLowerCase());
}

/** The first preset not used by an existing activity, so new activities start distinct. */
export function suggestColor(used: readonly string[]): string {
  const taken = new Set(used.map((hex) => hex.toLowerCase()));
  return (PRESET_COLORS.find((preset) => !taken.has(preset.hex.toLowerCase())) ?? PRESET_COLORS[0]!).hex;
}
