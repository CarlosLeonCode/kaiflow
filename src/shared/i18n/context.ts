import { createContext, useContext } from "react";

import { en, type Messages } from "./en";
import { es } from "./es";
import type { Language } from "./language";

const MESSAGES: Record<Language, Messages> = { en, es };

/** The active language; English outside a provider (isolated component tests). */
export const LanguageContext = createContext<Language>("en");

/** The `Intl` tag for the active language (keeps the OS region when it matches). */
export const LocaleContext = createContext<string>("en");

/** UI copy for the active language: `const t = useT(); t.shell.sections.today`. */
export function useT(): Messages {
  return MESSAGES[useContext(LanguageContext)];
}

/** The active language (`en` or `es`), for what is not UI copy, such as the AI review's language. */
export function useLanguage(): Language {
  return useContext(LanguageContext);
}

/** BCP 47 tag for `Intl` and `toLocaleDateString`, such as `en-GB` or `es`. */
export function useLocale(): string {
  return useContext(LocaleContext);
}
