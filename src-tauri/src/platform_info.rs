//! Which platform the UI runs on (`platform_info`). The OS is the build target; the Linux
//! display session comes from the mode `adapters-linux` detected at startup (see
//! `platform.rs`). Pure, so every branch is tested on every platform.

use crate::ipc::dto::{DisplaySessionDto, OsDto, PlatformInfoDto};

/// The OS this binary was built for. Other Unix desktops get the Linux wording (no
/// permission step), which is the closest match.
pub const fn current_os() -> OsDto {
    if cfg!(target_os = "macos") {
        OsDto::Macos
    } else if cfg!(windows) {
        OsDto::Windows
    } else {
        OsDto::Linux
    }
}

/// Builds the answer for `os`. A display session only exists on Linux; only macOS gates
/// window titles behind a permission (Accessibility).
pub fn platform_info(os: OsDto, session: Option<DisplaySessionDto>) -> PlatformInfoDto {
    PlatformInfoDto {
        os,
        session: if os == OsDto::Linux { session } else { None },
        needs_accessibility_permission: os == OsDto::Macos,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_needs_the_accessibility_permission_and_has_no_session() {
        let info = platform_info(OsDto::Macos, Some(DisplaySessionDto::X11));
        assert_eq!(
            info,
            PlatformInfoDto {
                os: OsDto::Macos,
                session: None,
                needs_accessibility_permission: true,
            }
        );
    }

    #[test]
    fn windows_needs_no_permission() {
        let info = platform_info(OsDto::Windows, None);
        assert_eq!(info.session, None);
        assert!(!info.needs_accessibility_permission);
    }

    #[test]
    fn linux_reports_its_display_session() {
        for session in [
            Some(DisplaySessionDto::X11),
            Some(DisplaySessionDto::Wayland),
            None,
        ] {
            let info = platform_info(OsDto::Linux, session);
            assert_eq!(info.session, session);
            assert!(!info.needs_accessibility_permission);
        }
    }

    #[test]
    fn the_current_os_matches_the_build_target() {
        let expected = if cfg!(target_os = "macos") {
            OsDto::Macos
        } else if cfg!(windows) {
            OsDto::Windows
        } else {
            OsDto::Linux
        };
        assert_eq!(current_os(), expected);
    }

    #[test]
    fn serializes_with_the_names_the_ui_expects() {
        let json = serde_json::to_string(&platform_info(
            OsDto::Linux,
            Some(DisplaySessionDto::Wayland),
        ))
        .unwrap();
        assert_eq!(
            json,
            r#"{"os":"linux","session":"wayland","needs_accessibility_permission":false}"#
        );
        let mac = serde_json::to_string(&platform_info(OsDto::Macos, None)).unwrap();
        assert_eq!(
            mac,
            r#"{"os":"macos","session":null,"needs_accessibility_permission":true}"#
        );
        assert_eq!(
            serde_json::to_string(&DisplaySessionDto::X11).unwrap(),
            r#""x11""#
        );
    }
}
