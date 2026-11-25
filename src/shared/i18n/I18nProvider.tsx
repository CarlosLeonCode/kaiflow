import { type ReactNode, useEffect } from "react";

import { useSettingsQuery } from "@/shared/ipc";

import { LanguageContext, LocaleContext } from "./context";
import { type Language, localeTag, parseLanguage, resolveLanguage, systemLanguage } from "./language";

interface Props {
  children: ReactNode;
  /** The OS language; read from `navigator.language` when omitted (tests pin it). */
  system?: Language;
}

/**
 * Picks the UI language from the `language` setting. Until settings load it uses the OS
 * language, which is also what `system` (the default) resolves to, so there is no flash.
 */
export function I18nProvider({ children, system }: Props) {
  const settings = useSettingsQuery();
  const language = resolveLanguage(parseLanguage(settings.data?.language), system ?? systemLanguage());
  // A pinned `system` (tests) has no OS region to keep.
  const locale = system ? language : localeTag(language);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return (
    <LanguageContext.Provider value={language}>
      <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
    </LanguageContext.Provider>
  );
}
