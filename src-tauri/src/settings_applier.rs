//! Applies the settings that live outside the database: the OS login item (autostart,
//! `LaunchAgent` on macOS), the global shortcut and the tray text. Called by `settings_update` and once at
//! startup so the OS state follows the stored settings.

use std::sync::Arc;

use tauri::{AppHandle, Wry};
use tauri_plugin_autostart::ManagerExt;

use crate::composition::SettingsApplier;
use crate::error::AppError;
use crate::shortcuts::ShortcutManager;
use crate::tray_text::TrayText;

/// Seam over the OS login item so reconciliation is tested without touching `LaunchAgents`.
pub trait LoginItem: Send + Sync {
    fn is_enabled(&self) -> Result<bool, String>;
    fn set(&self, enabled: bool) -> Result<(), String>;
}

/// Brings the login item in line with `wanted`; touches the OS only when they differ.
pub fn reconcile(item: &dyn LoginItem, wanted: bool) -> Result<(), String> {
    if item.is_enabled()? == wanted {
        return Ok(());
    }
    item.set(wanted)
}

/// `tauri-plugin-autostart`, only ever called from Rust.
pub struct TauriLoginItem {
    app: AppHandle<Wry>,
}

impl TauriLoginItem {
    pub fn new(app: AppHandle<Wry>) -> Self {
        Self { app }
    }
}

impl LoginItem for TauriLoginItem {
    fn is_enabled(&self) -> Result<bool, String> {
        self.app
            .autolaunch()
            .is_enabled()
            .map_err(|e| e.to_string())
    }

    fn set(&self, enabled: bool) -> Result<(), String> {
        let launcher = self.app.autolaunch();
        let result = if enabled {
            launcher.enable()
        } else {
            launcher.disable()
        };
        result.map_err(|e| e.to_string())
    }
}

pub struct ShellApplier {
    login: Box<dyn LoginItem>,
    shortcuts: Arc<ShortcutManager>,
    tray_text: TrayText,
}

impl ShellApplier {
    pub fn new(
        login: Box<dyn LoginItem>,
        shortcuts: Arc<ShortcutManager>,
        tray_text: TrayText,
    ) -> Self {
        Self {
            login,
            shortcuts,
            tray_text,
        }
    }
}

impl SettingsApplier for ShellApplier {
    fn set_autostart(&self, enabled: bool) -> Result<(), AppError> {
        reconcile(self.login.as_ref(), enabled).map_err(|message| AppError::Internal {
            message: format!("autostart: {message}"),
        })
    }

    fn set_shortcut(&self, shortcut: &str) -> Result<(), AppError> {
        self.shortcuts.apply(shortcut)
    }

    fn refresh_tray_text(&self) {
        self.tray_text.refresh();
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    struct FakeLogin {
        enabled: Mutex<bool>,
        sets: Mutex<Vec<bool>>,
        fail: bool,
    }

    impl LoginItem for FakeLogin {
        fn is_enabled(&self) -> Result<bool, String> {
            Ok(*self.enabled.lock().unwrap())
        }
        fn set(&self, enabled: bool) -> Result<(), String> {
            if self.fail {
                return Err("denied".into());
            }
            self.sets.lock().unwrap().push(enabled);
            *self.enabled.lock().unwrap() = enabled;
            Ok(())
        }
    }

    fn login(enabled: bool, fail: bool) -> FakeLogin {
        FakeLogin {
            enabled: Mutex::new(enabled),
            sets: Mutex::new(Vec::new()),
            fail,
        }
    }

    #[test]
    fn reconcile_only_acts_on_a_difference() {
        let item = login(false, false);
        reconcile(&item, false).unwrap();
        assert!(item.sets.lock().unwrap().is_empty());
        reconcile(&item, true).unwrap();
        reconcile(&item, true).unwrap();
        assert_eq!(*item.sets.lock().unwrap(), vec![true]);
        reconcile(&item, false).unwrap();
        assert_eq!(*item.sets.lock().unwrap(), vec![true, false]);
    }

    #[test]
    fn reconcile_reports_os_failures() {
        assert_eq!(reconcile(&login(false, true), true).unwrap_err(), "denied");
    }
}
