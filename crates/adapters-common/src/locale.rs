//! [`SystemLocale`] over `sys-locale`, one implementation for every platform:
//! - macOS: the first of the user's preferred languages (`CFLocaleCopyPreferredLanguages`),
//!   the list in System Settings > General > Language & Region;
//! - Windows: the first preferred UI language (`GetUserPreferredUILanguages`);
//! - Linux: `LANGUAGE`, then `LC_ALL`, `LC_MESSAGES` and `LANG`, as POSIX tools read them.
//!
//! The webview reads `navigator.language`, which follows the same OS preference.

use application::ports::SystemLocale;

#[derive(Debug, Clone, Copy, Default)]
pub struct OsLocale;

impl SystemLocale for OsLocale {
    fn language_tag(&self) -> Option<String> {
        sys_locale::get_locale().filter(|tag| !tag.trim().is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_os_gives_a_tag_or_nothing_but_never_an_empty_one() {
        // The value depends on the machine; only its shape is checked.
        if let Some(tag) = OsLocale.language_tag() {
            assert!(!tag.trim().is_empty());
        }
    }
}
