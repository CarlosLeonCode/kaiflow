//! Turning what Win32 returns (executable paths, UTF-16 buffers) into the identity and title
//! the engine records. Pure, so it is tested on every platform.

use adapters_common::activation::AppIdentity;

/// Entries kept in the `FileDescription` cache before it is reset.
pub const MAX_DESCRIPTIONS: usize = 256;

/// File name of an executable path. Accepts both separators so tests can use either.
pub fn exe_file_name(path: &str) -> Option<&str> {
    let name = path.rsplit(['\\', '/']).next()?.trim();
    (!name.is_empty()).then_some(name)
}

/// Stable application id: the lowercase executable file name (`code.exe`).
///
/// The full path is not used because many apps install into versioned folders
/// (`app-1.0.9\Discord.exe`), which would split one app into many after every update and
/// break the per-app privacy and category rules.
pub fn app_id_from_exe(path: &str) -> Option<String> {
    exe_file_name(path).map(str::to_lowercase)
}

/// Executable file name without its `.exe` extension (`Code.exe` -> `Code`).
pub fn exe_stem(path: &str) -> Option<String> {
    let name = exe_file_name(path)?;
    let stem = match name.len().checked_sub(4) {
        Some(cut) if name.is_char_boundary(cut) && name[cut..].eq_ignore_ascii_case(".exe") => {
            &name[..cut]
        }
        _ => name,
    };
    let stem = stem.trim();
    (!stem.is_empty()).then(|| stem.to_owned())
}

/// Display name: the version resource's `FileDescription` ("Visual Studio Code") when it is
/// present, otherwise the executable stem.
pub fn display_name(path: &str, description: Option<&str>) -> Option<String> {
    description
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .map(str::to_owned)
        .or_else(|| exe_stem(path))
}

/// Identity of the process behind the foreground window; `None` for an unusable path.
pub fn identity_from_exe(path: &str, description: Option<&str>) -> Option<AppIdentity> {
    let bundle_id = app_id_from_exe(path)?;
    let name = display_name(path, description).unwrap_or_else(|| bundle_id.clone());
    Some(AppIdentity { bundle_id, name })
}

/// Text from a UTF-16 buffer filled by Win32: stops at the first NUL, replaces invalid
/// surrogates, trims, and maps an empty result to `None`.
pub fn text_from_utf16(buffer: &[u16]) -> Option<String> {
    let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    let text = String::from_utf16_lossy(&buffer[..end]);
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_owned())
}

/// `VerQueryValueW` sub-block for the `FileDescription` of one language/code-page pair.
pub fn description_key(language: u16, code_page: u16) -> String {
    format!("\\StringFileInfo\\{language:04x}{code_page:04x}\\FileDescription")
}

/// Language/code-page pairs to try: the ones the file declares (`\VarFileInfo\Translation`,
/// pairs of `u16`), then US English with Unicode and Western code pages as a fallback.
pub fn description_keys(translations: &[u16]) -> Vec<String> {
    let mut keys: Vec<String> = translations
        .as_chunks::<2>()
        .0
        .iter()
        .map(|&[language, code_page]| description_key(language, code_page))
        .collect();
    for fallback in [
        description_key(0x0409, 0x04b0),
        description_key(0x0409, 0x04e4),
    ] {
        if !keys.contains(&fallback) {
            keys.push(fallback);
        }
    }
    keys
}

#[cfg(test)]
mod tests {
    use super::*;

    const CODE: &str = r"C:\Users\me\AppData\Local\Programs\Microsoft VS Code\Code.exe";

    #[test]
    fn the_app_id_is_the_lowercase_file_name() {
        assert_eq!(app_id_from_exe(CODE).as_deref(), Some("code.exe"));
        assert_eq!(
            app_id_from_exe("/mnt/c/Windows/explorer.exe").as_deref(),
            Some("explorer.exe")
        );
        assert_eq!(app_id_from_exe(r"C:\dir\"), None);
        assert_eq!(app_id_from_exe(""), None);
    }

    #[test]
    fn versioned_install_folders_share_one_app_id() {
        assert_eq!(
            app_id_from_exe(r"C:\Discord\app-1.0.9\Discord.exe"),
            app_id_from_exe(r"C:\Discord\app-1.0.10\Discord.exe")
        );
    }

    #[test]
    fn the_stem_drops_the_exe_extension_in_any_case() {
        assert_eq!(exe_stem(CODE).as_deref(), Some("Code"));
        assert_eq!(exe_stem(r"C:\x\NOTEPAD.EXE").as_deref(), Some("NOTEPAD"));
        assert_eq!(exe_stem(r"C:\x\tool").as_deref(), Some("tool"));
        assert_eq!(exe_stem(r"C:\x\.exe"), None);
        assert_eq!(
            exe_stem("C:\\x\\caf\u{e9}.exe").as_deref(),
            Some("caf\u{e9}")
        );
    }

    #[test]
    fn the_file_description_wins_over_the_stem() {
        assert_eq!(
            display_name(CODE, Some("Visual Studio Code")).as_deref(),
            Some("Visual Studio Code")
        );
        assert_eq!(display_name(CODE, Some("   ")).as_deref(), Some("Code"));
        assert_eq!(display_name(CODE, None).as_deref(), Some("Code"));
    }

    #[test]
    fn identity_combines_id_and_name() {
        let identity = identity_from_exe(CODE, Some("Visual Studio Code")).unwrap();
        assert_eq!(identity.bundle_id, "code.exe");
        assert_eq!(identity.name, "Visual Studio Code");
        assert_eq!(identity_from_exe("", None), None);
    }

    #[test]
    fn utf16_text_stops_at_nul_and_trims() {
        let mut buffer: Vec<u16> = " Inbox - Outlook ".encode_utf16().collect();
        buffer.extend([0, b'x' as u16]);
        assert_eq!(text_from_utf16(&buffer).as_deref(), Some("Inbox - Outlook"));
        assert_eq!(text_from_utf16(&[0, 65]), None);
        assert_eq!(text_from_utf16(&[]), None);
        // A lone surrogate is replaced, not an error.
        assert_eq!(text_from_utf16(&[0xD800, 65]).as_deref(), Some("\u{FFFD}A"));
    }

    #[test]
    fn description_keys_use_declared_translations_then_fallbacks() {
        assert_eq!(
            description_key(0x0409, 0x04b0),
            r"\StringFileInfo\040904b0\FileDescription"
        );
        let keys = description_keys(&[0x0c0a, 0x04b0, 0x0409, 0x04b0, 0x0001]);
        assert_eq!(
            keys,
            vec![
                r"\StringFileInfo\0c0a04b0\FileDescription".to_string(),
                r"\StringFileInfo\040904b0\FileDescription".to_string(),
                r"\StringFileInfo\040904e4\FileDescription".to_string(),
            ]
        );
    }
}
