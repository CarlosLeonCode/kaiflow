import { describe, expect, it } from "vitest";

/**
 * Guards the translation: UI copy lives in `src/shared/i18n`, so a component with an obvious
 * English sentence in its JSX (a text node, or a literal label, title or placeholder) was
 * missed. This is a coarse text scan, not a parser: it only catches the plain cases.
 */
const SOURCES = import.meta.glob<string>(["./**/*.tsx", "!./**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Product names and other text that is the same in every language. */
const ALLOWED = new Set(["Kaiflow"]);

const PATTERNS: readonly RegExp[] = [
  // A JSX text line of its own: `  Save note`.
  /^\s+([A-Z][a-z]+(?:[ ,][A-Za-z…'’.,-]+)*)\s*$/,
  // Inline text between tags: `<p>No reads yet.</p>` (not an arrow's `=> Promise<...>`).
  /(?<!=)>\s*([A-Z][a-z]+(?: [A-Za-z…'’.,-]+)*)\s*</,
  // A literal user-facing attribute: `aria-label="Dismiss"`.
  /\b(?:aria-label|title|placeholder|label|description|confirmLabel|subtitle|hint)="([A-Z][a-z][^"]*)"/,
];

function findings(source: string): string[] {
  const found: string[] = [];
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    for (const pattern of PATTERNS) {
      const text = pattern.exec(line)?.[1];
      if (text && !ALLOWED.has(text)) found.push(trimmed);
    }
  }
  return found;
}

describe("feature components", () => {
  it("are scanned", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
  });

  it("catches the plain cases", () => {
    expect(findings("      <p>No reads yet.</p>")).toHaveLength(1);
    expect(findings("          Save note")).toHaveLength(1);
    expect(findings('<Button aria-label="Dismiss" />')).toHaveLength(1);
    expect(findings("<p>{t.data.never}</p>")).toEqual([]);
    expect(findings("// Some comment here")).toEqual([]);
    expect(findings("onSet: (id: string) => Promise<string | null>;")).toEqual([]);
  });

  it("take their copy from the messages", () => {
    const offenders = Object.entries(SOURCES).flatMap(([file, source]) =>
      findings(source).map((line) => `${file}: ${line}`),
    );
    expect(offenders).toEqual([]);
  });
});
