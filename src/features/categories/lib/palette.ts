/**
 * Preset category colors. Raw values are stored; every paint goes through
 * `tuneCategoryColor`, so a preset (or a custom color) stays readable in both themes.
 */
export interface Preset {
  name: string;
  hex: string;
}

export const PRESET_COLORS: readonly Preset[] = [
  { name: "Blue", hex: "#3b82f6" },
  { name: "Indigo", hex: "#6366f1" },
  { name: "Violet", hex: "#8b5cf6" },
  { name: "Pink", hex: "#ec4899" },
  { name: "Red", hex: "#ef4444" },
  { name: "Orange", hex: "#f97316" },
  { name: "Amber", hex: "#d97706" },
  { name: "Green", hex: "#22c55e" },
  { name: "Teal", hex: "#14b8a6" },
  { name: "Gray", hex: "#6b7280" },
];

export const DEFAULT_COLOR = PRESET_COLORS[0]!.hex;

export function presetFor(hex: string): Preset | undefined {
  return PRESET_COLORS.find((preset) => preset.hex.toLowerCase() === hex.toLowerCase());
}

/** The first preset not used by an existing category, so new categories start distinct. */
export function suggestColor(used: readonly string[]): string {
  const taken = new Set(used.map((hex) => hex.toLowerCase()));
  return (PRESET_COLORS.find((preset) => !taken.has(preset.hex.toLowerCase())) ?? PRESET_COLORS[0]!).hex;
}
