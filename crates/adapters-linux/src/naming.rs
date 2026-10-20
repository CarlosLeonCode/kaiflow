//! Turning X11 window properties and `/proc` entries into the identity and title the engine
//! records. Pure, so it is tested on every platform.

use std::path::Path;

use adapters_common::activation::AppIdentity;

/// `WM_CLASS`: the instance name (usually the executable) and the class name (the
/// application, as desktop files and `StartupWMClass` use it).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WmClass {
    pub instance: Option<String>,
    pub class: Option<String>,
}

/// Latin-1 (`STRING` properties) to Rust text.
fn latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|&b| char::from(b)).collect()
}

fn non_empty(text: &str) -> Option<String> {
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_owned())
}

/// `WM_CLASS` is two NUL-terminated strings, instance first. `None` when both are empty.
pub fn parse_wm_class(raw: &[u8]) -> Option<WmClass> {
    let mut parts = raw.split(|&b| b == 0);
    let instance = parts.next().and_then(|p| non_empty(&latin1(p)));
    let class = parts.next().and_then(|p| non_empty(&latin1(p)));
    (instance.is_some() || class.is_some()).then_some(WmClass { instance, class })
}

/// Window title: `_NET_WM_NAME` (UTF-8) first, then `WM_NAME`, which is UTF-8 when its type
/// is `UTF8_STRING` and Latin-1 (`STRING`, or ASCII-compatible `COMPOUND_TEXT`) otherwise.
pub fn decode_title(
    net_wm_name: Option<&[u8]>,
    wm_name: Option<&[u8]>,
    wm_name_is_utf8: bool,
) -> Option<String> {
    net_wm_name
        .and_then(|raw| non_empty(&String::from_utf8_lossy(raw)))
        .or_else(|| {
            let raw = wm_name?;
            if wm_name_is_utf8 {
                non_empty(&String::from_utf8_lossy(raw))
            } else {
                non_empty(&latin1(raw))
            }
        })
}

/// Human name from a class or process name: the last segment of a reverse-DNS id
/// (`org.gnome.Nautilus` -> `Nautilus`), separators as spaces and lowercase words
/// capitalized (`google-chrome` -> `Google Chrome`). Mixed-case words are kept (`VSCodium`).
pub fn pretty_name(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let base = if raw.matches('.').count() >= 2 {
        raw.rsplit('.').next().unwrap_or(raw)
    } else {
        raw
    };
    let words: Vec<String> = base
        .split(['-', '_', ' '])
        .filter(|w| !w.is_empty())
        .map(|word| {
            if word.chars().any(char::is_uppercase) {
                word.to_owned()
            } else {
                let mut chars = word.chars();
                chars.next().map_or_else(String::new, |first| {
                    first.to_uppercase().chain(chars).collect()
                })
            }
        })
        .collect();
    (!words.is_empty()).then(|| words.join(" "))
}

/// Process name from `/proc/<pid>/exe` (full executable name) or `/proc/<pid>/comm` (kernel
/// name, truncated to 15 bytes). Interpreters say nothing about the app, so they lose to comm.
pub fn process_name(exe: Option<&Path>, comm: Option<&str>) -> Option<String> {
    const INTERPRETERS: [&str; 6] = ["python", "python3", "java", "node", "electron", "perl"];
    let exe_name = exe
        .and_then(Path::file_name)
        .map(|n| {
            n.to_string_lossy()
                .trim_end_matches(" (deleted)")
                .to_owned()
        })
        .and_then(|n| non_empty(&n))
        .filter(|n| !INTERPRETERS.contains(&n.as_str()));
    exe_name.or_else(|| comm.and_then(non_empty))
}

/// Identity of the active window. The id comes from `WM_CLASS` (class, then instance) and
/// falls back to the process name; it is lowercased so `Code` and `code` stay one app.
/// Windows with none of them cannot be attributed and are not tracked.
pub fn identity(wm_class: Option<&WmClass>, process: Option<&str>) -> Option<AppIdentity> {
    let source = wm_class
        .and_then(|c| c.class.as_deref().or(c.instance.as_deref()))
        .or(process)?;
    let bundle_id = source.trim().to_lowercase();
    if bundle_id.is_empty() {
        return None;
    }
    let name = pretty_name(source).unwrap_or_else(|| bundle_id.clone());
    Some(AppIdentity { bundle_id, name })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wm_class_has_instance_then_class() {
        assert_eq!(
            parse_wm_class(b"navigator\0firefox\0"),
            Some(WmClass {
                instance: Some("navigator".into()),
                class: Some("firefox".into()),
            })
        );
        // Missing trailing NUL and a missing class.
        assert_eq!(
            parse_wm_class(b"xterm"),
            Some(WmClass {
                instance: Some("xterm".into()),
                class: None,
            })
        );
        assert_eq!(parse_wm_class(b"\0\0"), None);
        assert_eq!(parse_wm_class(b""), None);
    }

    #[test]
    fn wm_class_is_latin1() {
        let parsed = parse_wm_class(b"caf\xe9\0Caf\xe9\0").unwrap();
        assert_eq!(parsed.class.as_deref(), Some("Caf\u{e9}"));
    }

    #[test]
    fn net_wm_name_wins_and_wm_name_is_the_fallback() {
        assert_eq!(
            decode_title(Some("Inbox \u{2014} Mail".as_bytes()), Some(b"old"), false).as_deref(),
            Some("Inbox \u{2014} Mail")
        );
        assert_eq!(
            decode_title(Some(b"  "), Some(b"xterm"), false).as_deref(),
            Some("xterm")
        );
        assert_eq!(
            decode_title(None, Some(b"r\xe9sum\xe9"), false).as_deref(),
            Some("r\u{e9}sum\u{e9}")
        );
        assert_eq!(
            decode_title(None, Some("r\u{e9}sum\u{e9}".as_bytes()), true).as_deref(),
            Some("r\u{e9}sum\u{e9}")
        );
        assert_eq!(decode_title(None, None, false), None);
    }

    #[test]
    fn invalid_utf8_titles_are_kept_lossily() {
        assert_eq!(
            decode_title(Some(b"a\xffb"), None, false).as_deref(),
            Some("a\u{FFFD}b")
        );
    }

    #[test]
    fn pretty_names() {
        assert_eq!(pretty_name("firefox").as_deref(), Some("Firefox"));
        assert_eq!(
            pretty_name("google-chrome").as_deref(),
            Some("Google Chrome")
        );
        assert_eq!(
            pretty_name("Google-chrome").as_deref(),
            Some("Google Chrome")
        );
        assert_eq!(
            pretty_name("org.gnome.Nautilus").as_deref(),
            Some("Nautilus")
        );
        assert_eq!(pretty_name("VSCodium").as_deref(), Some("VSCodium"));
        assert_eq!(
            pretty_name("jetbrains_idea").as_deref(),
            Some("Jetbrains Idea")
        );
        assert_eq!(
            pretty_name("libreoffice7.6").as_deref(),
            Some("Libreoffice7.6")
        );
        assert_eq!(pretty_name(" - "), None);
    }

    #[test]
    fn process_name_prefers_the_executable_unless_it_is_an_interpreter() {
        assert_eq!(
            process_name(Some(Path::new("/usr/lib/slack/slack")), Some("slack")).as_deref(),
            Some("slack")
        );
        assert_eq!(
            process_name(
                Some(Path::new("/opt/very-long-application-name")),
                Some("very-long-appli")
            )
            .as_deref(),
            Some("very-long-application-name")
        );
        assert_eq!(
            process_name(Some(Path::new("/usr/bin/python3")), Some("meld")).as_deref(),
            Some("meld")
        );
        assert_eq!(
            process_name(Some(Path::new("/tmp/app (deleted)")), None).as_deref(),
            Some("app")
        );
        assert_eq!(process_name(None, Some("  ")), None);
    }

    #[test]
    fn identity_uses_class_then_instance_then_process() {
        let both = WmClass {
            instance: Some("code".into()),
            class: Some("Code".into()),
        };
        let id = identity(Some(&both), Some("electron")).unwrap();
        assert_eq!((id.bundle_id.as_str(), id.name.as_str()), ("code", "Code"));

        let instance_only = WmClass {
            instance: Some("xterm".into()),
            class: None,
        };
        let id = identity(Some(&instance_only), None).unwrap();
        assert_eq!(
            (id.bundle_id.as_str(), id.name.as_str()),
            ("xterm", "Xterm")
        );

        let id = identity(None, Some("gedit")).unwrap();
        assert_eq!(
            (id.bundle_id.as_str(), id.name.as_str()),
            ("gedit", "Gedit")
        );

        assert_eq!(identity(None, None), None);
        assert_eq!(identity(None, Some(" ")), None);
    }
}
