/** A language the UI is translated to. Doubles as the BCP 47 tag for `Intl`. */
export type Language = "en" | "es";

/** The `language` setting: a language, or `system` to follow the OS. */
export type LanguageSetting = Language | "system";

export const LANGUAGES: readonly Language[] = ["en", "es"];

/** Language names, written in their own language (never translated). */
export const LANGUAGE_NAMES: Record<Language, string> = { en: "English", es: "Español" };

/** Settings store the language as a free string; anything unknown behaves as `system`. */
export function parseLanguage(value: string | undefined): LanguageSetting {
  return value === "en" || value === "es" ? value : "system";
}

/** The OS language: any Spanish variant (`es`, `es-MX`, ...) gives Spanish, the rest English. */
export function systemLanguage(tag: string | undefined = globalThis.navigator?.language): Language {
  return tag?.toLowerCase().startsWith("es") ? "es" : "en";
}

export function resolveLanguage(setting: LanguageSetting, system: Language): Language {
  return setting === "system" ? system : setting;
}
