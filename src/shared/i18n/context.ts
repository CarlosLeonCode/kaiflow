import { createContext, useContext } from "react";

import { en, type Messages } from "./en";
import { es } from "./es";
import type { Language } from "./language";

const MESSAGES: Record<Language, Messages> = { en, es };

/** The active language; English outside a provider (isolated component tests). */
export const LanguageContext = createContext<Language>("en");

/** UI copy for the active language: `const t = useT(); t.shell.sections.today`. */
export function useT(): Messages {
  return MESSAGES[useContext(LanguageContext)];
}

/** BCP 47 tag of the active language, for `Intl` and `toLocaleDateString`. */
export function useLocale(): Language {
  return useContext(LanguageContext);
}
