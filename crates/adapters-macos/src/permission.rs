//! Accessibility permission (design sections 6 and 11, tasks 2.6): live trust check, the
//! system prompt, the Settings deep link and the app relaunch helper.
//!
//! `AXIsProcessTrusted*` is cheap and thread-safe, so the sampler can call it on every tick.

use std::path::{Path, PathBuf};
use std::process::Command;

use domain::PermissionState;

/// Opens System Settings at Privacy & Security > Accessibility (verified in the phase 2 spike).
pub const ACCESSIBILITY_SETTINGS_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

/// Maps the raw `AXIsProcessTrusted` answer to the domain state.
pub fn state_from_trusted(trusted: bool) -> PermissionState {
    if trusted {
        PermissionState::Granted
    } else {
        PermissionState::Denied
    }
}

/// `Contents/MacOS/<exe>` inside a `.app` -> the bundle root. `None` when the executable is
/// not inside a bundle (for example `cargo run` or `tauri dev`).
pub fn bundle_path_from_exe(exe: &Path) -> Option<PathBuf> {
    let macos_dir = exe.parent()?;
    let contents = macos_dir.parent()?;
    let bundle = contents.parent()?;
    let in_bundle = macos_dir.file_name()? == "MacOS"
        && contents.file_name()? == "Contents"
        && bundle.extension()? == "app";
    in_bundle.then(|| bundle.to_path_buf())
}

/// Arguments of the `open` call that starts a fresh instance of the bundle.
fn relaunch_args(bundle: &Path) -> Vec<String> {
    vec!["-n".into(), bundle.to_string_lossy().into_owned()]
}

/// Starts a brand new instance of the running `.app` through LaunchServices (new pid, so
/// TCC and the AX client cache are evaluated from scratch). The caller must then exit this
/// process. Fails outside a bundle; callers fall back to Tauri's `restart` in that case.
pub fn spawn_relaunch() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let bundle = bundle_path_from_exe(&exe).ok_or("not running from an .app bundle")?;
    Command::new("/usr/bin/open")
        .args(relaunch_args(&bundle))
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Real implementation backed by the Accessibility (HIServices) C API.
#[cfg(target_os = "macos")]
#[derive(Debug, Default, Clone, Copy)]
pub struct MacPermissionProvider;

#[cfg(target_os = "macos")]
impl MacPermissionProvider {
    pub fn new() -> Self {
        Self
    }

    /// `AXIsProcessTrustedWithOptions(NULL)`: no UI.
    pub fn is_trusted() -> bool {
        // SAFETY: a null options dictionary is documented as "no options".
        unsafe { objc2_application_services::AXIsProcessTrustedWithOptions(None) }
    }

    /// `AXIsProcessTrustedWithOptions({prompt: true})`: shows the system prompt when the
    /// process is not trusted. The prompt is asynchronous and does not change the result.
    pub fn is_trusted_prompting() -> bool {
        use objc2_application_services::{
            AXIsProcessTrustedWithOptions, kAXTrustedCheckOptionPrompt,
        };
        use objc2_core_foundation::{CFBoolean, CFDictionary, CFType};

        let yes = CFBoolean::new(true);
        let options: objc2_core_foundation::CFRetained<CFDictionary<_, CFType>> =
            // SAFETY: the key is the documented constant and the value a CFBoolean.
            CFDictionary::from_slices(&[unsafe { kAXTrustedCheckOptionPrompt }], &[yes.as_ref()]);
        // SAFETY: `options` is a valid CFDictionary with the documented key type.
        unsafe { AXIsProcessTrustedWithOptions(Some(options.as_opaque())) }
    }
}

#[cfg(target_os = "macos")]
impl application::ports::PermissionProvider for MacPermissionProvider {
    fn accessibility(&self) -> PermissionState {
        state_from_trusted(Self::is_trusted())
    }

    fn request(&self) {
        Self::is_trusted_prompting();
    }

    fn open_settings(&self) {
        // Constant URL, no user input (design section 15). `open` returns immediately.
        let _ = Command::new("/usr/bin/open")
            .arg(ACCESSIBILITY_SETTINGS_URL)
            .spawn();
    }
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    use application::ports::PermissionProvider;

    use super::*;

    #[test]
    fn trusted_maps_to_granted_and_untrusted_to_denied() {
        assert_eq!(state_from_trusted(true), PermissionState::Granted);
        assert_eq!(state_from_trusted(false), PermissionState::Denied);
    }

    #[test]
    fn bundle_path_is_found_for_an_app_executable() {
        let exe = Path::new(
            "/Users/me/Applications/Time Track Copilot.app/Contents/MacOS/time-track-app",
        );
        assert_eq!(
            bundle_path_from_exe(exe),
            Some(PathBuf::from(
                "/Users/me/Applications/Time Track Copilot.app"
            ))
        );
    }

    #[test]
    fn bundle_path_is_none_for_a_plain_binary() {
        assert_eq!(
            bundle_path_from_exe(Path::new("/repo/target/debug/time-track-app")),
            None
        );
        assert_eq!(
            bundle_path_from_exe(Path::new("/x/Foo.app/Contents/Resources/bin")),
            None
        );
    }

    #[test]
    fn relaunch_opens_a_new_instance_of_the_bundle() {
        assert_eq!(
            relaunch_args(Path::new("/A/B.app")),
            vec!["-n".to_string(), "/A/B.app".to_string()]
        );
    }

    #[test]
    fn settings_url_targets_the_accessibility_pane() {
        assert!(ACCESSIBILITY_SETTINGS_URL.ends_with("Privacy_Accessibility"));
        assert!(ACCESSIBILITY_SETTINGS_URL.starts_with("x-apple.systempreferences:"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn no_prompt_check_returns_without_ui() {
        // Reads the TCC state of the test runner; the value depends on the machine, only
        // the call itself (no UI, no panic) is asserted.
        let _ = MacPermissionProvider::new().accessibility();
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "shows the system Accessibility prompt; needs a GUI session and TCC"]
    fn prompting_check_shows_the_system_dialog() {
        MacPermissionProvider::new().request();
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "opens System Settings; needs a GUI session"]
    fn open_settings_launches_system_settings() {
        MacPermissionProvider::new().open_settings();
    }
}
