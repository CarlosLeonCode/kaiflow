/**
 * A small mirror of the Rust preset catalog (`domain::presets`) for the mocked backend:
 * enough packs and hints to drive the UI. The real hints live in Rust.
 */

import type { PresetActivityDto, PresetDto } from "@/shared/ipc";

interface MockHints {
  /** Exact app ids (bundle ids, exe names, WM_CLASS), compared case-insensitively. */
  ids: readonly string[];
  /** Lowercase whole words of the app name or id. */
  tokens: readonly string[];
}

interface MockActivity extends Omit<PresetActivityDto, "example_apps"> {
  hints: MockHints;
}

interface MockPack extends Omit<PresetDto, "activities"> {
  activities: readonly MockActivity[];
}

const PACKS: readonly MockPack[] = [
  {
    key: "general",
    name: "General",
    description: "Everyday apps: browsing, messages, notes and entertainment.",
    activities: [
      {
        key: "general.browsing",
        name: "Browsing",
        color: "#64748b",
        productivity: "neutral",
        hints: { ids: ["com.apple.Safari", "com.google.Chrome", "org.mozilla.firefox", "chrome.exe", "firefox"], tokens: ["safari", "chrome", "firefox"] },
      },
      {
        key: "general.notes",
        name: "Notes & documents",
        color: "#14b8a6",
        productivity: "neutral",
        hints: { ids: ["notion.id", "md.obsidian"], tokens: ["notion", "obsidian"] },
      },
    ],
  },
  {
    key: "development",
    name: "Development",
    description: "Editors, terminals and developer tooling.",
    activities: [
      {
        key: "development.coding",
        name: "Coding",
        color: "#6366f1",
        productivity: "productive",
        hints: { ids: ["com.apple.dt.Xcode", "com.microsoft.VSCode", "code.exe", "code"], tokens: ["xcode", "vscode"] },
      },
      {
        key: "development.terminal",
        name: "Terminal",
        color: "#22c55e",
        productivity: "productive",
        hints: { ids: ["com.apple.Terminal", "com.googlecode.iterm2"], tokens: ["terminal", "iterm2"] },
      },
    ],
  },
  {
    key: "design",
    name: "Design",
    description: "Design, illustration and video tools.",
    activities: [
      {
        key: "design.tools",
        name: "Design tools",
        color: "#d946ef",
        productivity: "productive",
        hints: { ids: ["com.figma.Desktop", "com.canva.CanvaDesktop"], tokens: ["figma", "canva", "sketch"] },
      },
    ],
  },
];

export function mockPresets(): PresetDto[] {
  return PACKS.map((pack) => ({
    key: pack.key,
    name: pack.name,
    description: pack.description,
    activities: pack.activities.map(({ hints, ...activity }) => ({
      ...activity,
      example_apps: hints.tokens.slice(0, 4),
    })),
  }));
}

function words(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function exact(activity: MockActivity, appId: string): boolean {
  return activity.hints.ids.some((id) => id.toLowerCase() === appId.toLowerCase());
}

function token(activity: MockActivity, appId: string, appName: string): boolean {
  return [...words(appName), ...words(appId)].some((word) => activity.hints.tokens.includes(word));
}

export interface MockMatch {
  pack: string;
  activity: Omit<MockActivity, "hints">;
}

/** Exact id first, then name tokens, searching `packKeys` in catalog order. */
export function matchPreset(appId: string, appName: string, packKeys?: readonly string[]): MockMatch | null {
  const candidates = PACKS.filter((pack) => !packKeys || packKeys.includes(pack.key)).flatMap((pack) =>
    pack.activities.map((activity) => ({ pack: pack.key, activity })),
  );
  const found =
    candidates.find((c) => exact(c.activity, appId)) ?? candidates.find((c) => token(c.activity, appId, appName));
  if (!found) return null;
  const { key, name, color, productivity } = found.activity;
  return { pack: found.pack, activity: { key, name, color, productivity } };
}
