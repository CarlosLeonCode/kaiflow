//! The interface language for text produced on the Rust side (tray menu, notifications,
//! window titles, the Monday AI review). The webview resolves the same setting on its own
//! (`src/shared/i18n/language.ts`); both follow the same rules so they always agree.
//!
//! Live handle, same pattern as [`crate::idle_policy::IdlePolicy`]: the `language` setting
//! sits in an atomic behind an `Arc`, so a settings change reaches every clone (the
//! notifiers, the tray) at once. `system` is resolved on every read, through the
//! [`SystemLocale`] port, so a notification uses the language current when it is posted.

use std::sync::Arc;
use std::sync::atomic::{AtomicU8, Ordering};

use crate::ports::SystemLocale;

/// A language the interface is translated to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Language {
    #[default]
    En,
    Es,
}

impl Language {
    /// Every language, for tests that walk the catalogs.
    pub const ALL: [Self; 2] = [Self::En, Self::Es];

    /// The name written in the language itself, never translated; what the AI review is
    /// asked to write in (the frontend's `LANGUAGE_NAMES`).
    pub const fn name(self) -> &'static str {
        match self {
            Self::En => "English",
            Self::Es => "Español",
        }
    }

    /// The OS language: any Spanish tag (`es`, `es-MX`, `ES_es`...) gives Spanish, everything
    /// else (or no tag at all) English.
    pub fn from_system_tag(tag: Option<&str>) -> Self {
        match tag {
            Some(tag) if tag.to_ascii_lowercase().starts_with("es") => Self::Es,
            _ => Self::En,
        }
    }
}

/// The `language` setting: a fixed language, or `system` to follow the OS.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LanguageSetting {
    #[default]
    System,
    Fixed(Language),
}

impl LanguageSetting {
    /// Settings store the language as a string; anything unknown behaves as `system`.
    pub fn parse(value: &str) -> Self {
        match value {
            "en" => Self::Fixed(Language::En),
            "es" => Self::Fixed(Language::Es),
            _ => Self::System,
        }
    }

    pub fn resolve(self, system_tag: Option<&str>) -> Language {
        match self {
            Self::System => Language::from_system_tag(system_tag),
            Self::Fixed(language) => language,
        }
    }

    const fn to_bits(self) -> u8 {
        match self {
            Self::System => 0,
            Self::Fixed(Language::En) => 1,
            Self::Fixed(Language::Es) => 2,
        }
    }

    const fn from_bits(bits: u8) -> Self {
        match bits {
            1 => Self::Fixed(Language::En),
            2 => Self::Fixed(Language::Es),
            _ => Self::System,
        }
    }
}

/// Knows no OS language: `system` resolves to English.
struct NoLocale;

impl SystemLocale for NoLocale {
    fn language_tag(&self) -> Option<String> {
        None
    }
}

/// The live `language` setting plus the OS locale to resolve `system` with.
#[derive(Clone)]
pub struct UiLanguage {
    setting: Arc<AtomicU8>,
    locale: Arc<dyn SystemLocale>,
}

impl UiLanguage {
    /// Starts on `system`; `compose` sets the stored value.
    pub fn new(locale: Arc<dyn SystemLocale>) -> Self {
        Self {
            setting: Arc::new(AtomicU8::new(LanguageSetting::System.to_bits())),
            locale,
        }
    }

    /// Follows the stored setting (`en`, `es`, `system`; unknown values mean `system`).
    pub fn set(&self, value: &str) {
        self.setting
            .store(LanguageSetting::parse(value).to_bits(), Ordering::Relaxed);
    }

    pub fn setting(&self) -> LanguageSetting {
        LanguageSetting::from_bits(self.setting.load(Ordering::Relaxed))
    }

    /// The language to write in right now. Reads the OS only when the setting is `system`.
    pub fn current(&self) -> Language {
        match self.setting() {
            LanguageSetting::Fixed(language) => language,
            LanguageSetting::System => {
                LanguageSetting::System.resolve(self.locale.language_tag().as_deref())
            }
        }
    }
}

impl Default for UiLanguage {
    /// No OS locale: English unless the setting says otherwise (tests, placeholders).
    fn default() -> Self {
        Self::new(Arc::new(NoLocale))
    }
}

impl std::fmt::Debug for UiLanguage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("UiLanguage")
            .field("setting", &self.setting())
            .finish_non_exhaustive()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    /// An OS locale the test can change while the app "runs".
    #[derive(Default)]
    struct FakeLocale(Mutex<Option<String>>);

    impl FakeLocale {
        fn set(&self, tag: Option<&str>) {
            *self.0.lock().unwrap() = tag.map(str::to_owned);
        }
    }

    impl SystemLocale for FakeLocale {
        fn language_tag(&self) -> Option<String> {
            self.0.lock().unwrap().clone()
        }
    }

    #[test]
    fn any_spanish_tag_means_spanish_and_the_rest_english() {
        for tag in ["es", "es-ES", "es-MX", "es-419", "ES", "es_CO.UTF-8"] {
            assert_eq!(Language::from_system_tag(Some(tag)), Language::Es, "{tag}");
        }
        for tag in ["en", "en-US", "fr-FR", "pt-BR", "C", "", "eu-ES", "ca-ES"] {
            assert_eq!(Language::from_system_tag(Some(tag)), Language::En, "{tag}");
        }
        assert_eq!(Language::from_system_tag(None), Language::En);
    }

    #[test]
    fn the_setting_parses_like_the_frontend() {
        assert_eq!(
            LanguageSetting::parse("en"),
            LanguageSetting::Fixed(Language::En)
        );
        assert_eq!(
            LanguageSetting::parse("es"),
            LanguageSetting::Fixed(Language::Es)
        );
        for other in ["system", "", "fr", "ES", "es-ES"] {
            assert_eq!(LanguageSetting::parse(other), LanguageSetting::System);
        }
    }

    #[test]
    fn a_fixed_language_ignores_the_os() {
        let es = LanguageSetting::Fixed(Language::Es);
        let en = LanguageSetting::Fixed(Language::En);
        assert_eq!(es.resolve(Some("en-US")), Language::Es);
        assert_eq!(en.resolve(Some("es-MX")), Language::En);
        assert_eq!(LanguageSetting::System.resolve(Some("es-MX")), Language::Es);
        assert_eq!(LanguageSetting::System.resolve(None), Language::En);
    }

    #[test]
    fn names_match_the_frontend_and_never_change_with_the_language() {
        assert_eq!(Language::En.name(), "English");
        assert_eq!(Language::Es.name(), "Español");
    }

    #[test]
    fn the_handle_follows_the_setting_and_the_os_on_every_read() {
        let locale = Arc::new(FakeLocale::default());
        let language = UiLanguage::new(locale.clone());
        let clone = language.clone();
        assert_eq!(language.setting(), LanguageSetting::System);
        assert_eq!(language.current(), Language::En);

        // `system` is read again each time: an OS change applies to the next message.
        locale.set(Some("es-AR"));
        assert_eq!(clone.current(), Language::Es);

        // A change through one clone reaches the others.
        language.set("en");
        assert_eq!(clone.current(), Language::En);
        language.set("es");
        locale.set(Some("en-GB"));
        assert_eq!(clone.current(), Language::Es);
        language.set("bogus");
        assert_eq!(clone.setting(), LanguageSetting::System);
        assert_eq!(clone.current(), Language::En);
    }

    #[test]
    fn without_an_os_locale_the_default_is_english() {
        let language = UiLanguage::default();
        assert_eq!(language.current(), Language::En);
        language.set("es");
        assert_eq!(language.current(), Language::Es);
    }
}
