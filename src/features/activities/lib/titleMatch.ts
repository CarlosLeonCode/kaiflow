/**
 * Plain-text "contains" matching for window-title rules. The backend only stores regular
 * expressions, so "contains text" is saved as a case-insensitive pattern of the escaped text
 * (`(?i)` followed by the text with every special character escaped) and recognized again
 * when the rule is shown. Regular expressions stay available as the advanced mode.
 */

export type TitleMatchMode = "contains" | "pattern";

/** Characters with a special meaning in both Rust `regex` and JavaScript patterns. */
const SPECIAL = new Set(["\\", ".", "+", "*", "?", "(", ")", "|", "[", "]", "{", "}", "^", "$"]);

const CASE_INSENSITIVE = "(?i)";

/** The pattern a "contains" rule is stored as; `text` is used as typed (not trimmed). */
export function containsPattern(text: string): string {
  let escaped = "";
  for (const char of text) escaped += SPECIAL.has(char) ? `\\${char}` : char;
  return `${CASE_INSENSITIVE}${escaped}`;
}

/** The text of a pattern written by `containsPattern`, or `null` for any other pattern. */
export function containsText(pattern: string): string | null {
  if (!pattern.startsWith(CASE_INSENSITIVE)) return null;
  const rest = pattern.slice(CASE_INSENSITIVE.length);
  let text = "";
  for (let i = 0; i < rest.length; i++) {
    const char = rest[i] as string;
    if (char === "\\") {
      const next = rest[i + 1];
      if (next === undefined || !SPECIAL.has(next)) return null;
      text += next;
      i++;
    } else if (SPECIAL.has(char)) {
      return null;
    } else {
      text += char;
    }
  }
  return text.length > 0 ? text : null;
}
