import { en } from "./en";
import { es } from "./es";
import type { Content, Locale } from "./types";

export { LOCALES, type Content, type Locale } from "./types";

const CONTENT: Record<Locale, Content> = { en, es };

/** BCP 47 tags used for `<html lang>` and Open Graph. */
export const LANG_TAG: Record<Locale, { html: string; og: string }> = {
  en: { html: "en", og: "en_US" },
  es: { html: "es", og: "es_ES" },
};

export function getContent(locale: Locale): Content {
  return CONTENT[locale];
}

export function toLocale(value: string | undefined): Locale {
  return value === "es" ? "es" : "en";
}
