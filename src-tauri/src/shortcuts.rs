//! Global shortcut that pauses/resumes tracking (design section 10, R6.3). Registration runs
//! in Rust at startup and whenever `settings_update` changes the shortcut. When the key
//! combination is taken the status becomes `Unavailable`, the frontend is notified and the
//! app keeps working: pause/resume stays reachable from the popover and the tray menu.

use std::sync::{Arc, Mutex, PoisonError};

use tauri::{AppHandle, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_specta::Event;

use crate::error::AppError;
use crate::ipc::dto::ShortcutStatusDto;
use crate::ipc::events::{SharedShortcut, ShortcutStatusChanged};

/// Handler run when the registered combination is pressed.
pub type OnPress = Arc<dyn Fn() + Send + Sync>;

/// Seam over the OS registration so the policy is tested without a desktop session.
pub trait ShortcutRegistrar: Send + Sync {
    /// Registers `accelerator` (for example `Ctrl+Alt+Cmd+T`); the reason is user-readable.
    fn register(&self, accelerator: &str, on_press: OnPress) -> Result<(), String>;
    fn unregister(&self, accelerator: &str);
}

/// Converts the stored form (`⌃⌥⌘T`) to the accelerator syntax of the plugin. Strings that
/// already look like accelerators (`Ctrl+Alt+T`) pass through unchanged.
pub fn to_accelerator(shortcut: &str) -> String {
    let shortcut = shortcut.trim();
    if shortcut.contains('+') {
        return shortcut.to_string();
    }
    let mut parts: Vec<String> = Vec::new();
    let mut key = String::new();
    for ch in shortcut.chars() {
        match ch {
            '⌃' => parts.push("Ctrl".into()),
            '⌥' => parts.push("Alt".into()),
            '⇧' => parts.push("Shift".into()),
            '⌘' => parts.push("Cmd".into()),
            other => key.push(other),
        }
    }
    if !key.is_empty() {
        parts.push(key);
    }
    parts.join("+")
}

pub struct ShortcutManager {
    registrar: Box<dyn ShortcutRegistrar>,
    status: SharedShortcut,
    announce: Box<dyn Fn(ShortcutStatusDto) + Send + Sync>,
    on_press: OnPress,
    registered: Mutex<Option<String>>,
}

impl ShortcutManager {
    pub fn new(
        registrar: Box<dyn ShortcutRegistrar>,
        status: SharedShortcut,
        announce: Box<dyn Fn(ShortcutStatusDto) + Send + Sync>,
        on_press: OnPress,
    ) -> Self {
        Self {
            registrar,
            status,
            announce,
            on_press,
            registered: Mutex::new(None),
        }
    }

    /// Replaces the registered shortcut. On failure the state is `Unavailable` and the error
    /// is returned; nothing else is affected.
    pub fn apply(&self, shortcut: &str) -> Result<(), AppError> {
        let mut registered = self
            .registered
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if let Some(previous) = registered.take() {
            self.registrar.unregister(&previous);
        }
        let accelerator = to_accelerator(shortcut);
        match self.registrar.register(&accelerator, self.on_press.clone()) {
            Ok(()) => {
                *registered = Some(accelerator);
                self.publish(ShortcutStatusDto::Registered {
                    shortcut: shortcut.to_string(),
                });
                Ok(())
            }
            Err(reason) => {
                self.publish(ShortcutStatusDto::Unavailable {
                    shortcut: shortcut.to_string(),
                    reason: reason.clone(),
                });
                Err(AppError::ShortcutUnavailable {
                    shortcut: shortcut.to_string(),
                    reason,
                })
            }
        }
    }

    fn publish(&self, status: ShortcutStatusDto) {
        *self.status.lock().unwrap_or_else(PoisonError::into_inner) = status.clone();
        (self.announce)(status);
    }
}

/// Registrar backed by `tauri-plugin-global-shortcut`, only ever called from Rust.
pub struct TauriRegistrar {
    app: AppHandle<Wry>,
}

impl TauriRegistrar {
    pub fn new(app: AppHandle<Wry>) -> Self {
        Self { app }
    }
}

impl ShortcutRegistrar for TauriRegistrar {
    fn register(&self, accelerator: &str, on_press: OnPress) -> Result<(), String> {
        self.app
            .global_shortcut()
            .on_shortcut(accelerator, move |_app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    on_press();
                }
            })
            .map_err(|e| e.to_string())
    }

    fn unregister(&self, accelerator: &str) {
        let _ = self.app.global_shortcut().unregister(accelerator);
    }
}

/// Accelerator to show next to Pause/Resume in the tray menu: only a shortcut that is
/// actually registered, so the menu never advertises a combination that does nothing.
pub fn menu_accelerator(status: &ShortcutStatusDto) -> Option<String> {
    match status {
        ShortcutStatusDto::Registered { shortcut } => Some(to_accelerator(shortcut)),
        _ => None,
    }
}

/// Frontend notification and tray menu hint for a status change (best effort).
pub fn announce_to_frontend(app: AppHandle<Wry>) -> Box<dyn Fn(ShortcutStatusDto) + Send + Sync> {
    Box::new(move |status| {
        crate::tray::set_shortcut_hint(&app, menu_accelerator(&status));
        let _ = ShortcutStatusChanged(status).emit(&app);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct FakeRegistrar {
        taken: Mutex<Vec<String>>,
        registered: Mutex<Vec<String>>,
        handlers: Mutex<Vec<OnPress>>,
    }

    impl FakeRegistrar {
        fn take(&self, accelerator: &str) {
            self.taken.lock().unwrap().push(accelerator.into());
        }
    }

    impl ShortcutRegistrar for Arc<FakeRegistrar> {
        fn register(&self, accelerator: &str, on_press: OnPress) -> Result<(), String> {
            if self.taken.lock().unwrap().iter().any(|t| t == accelerator) {
                return Err("already in use by another application".into());
            }
            self.registered.lock().unwrap().push(accelerator.into());
            self.handlers.lock().unwrap().push(on_press);
            Ok(())
        }
        fn unregister(&self, accelerator: &str) {
            self.registered.lock().unwrap().retain(|r| r != accelerator);
        }
    }

    struct Rig {
        manager: ShortcutManager,
        registrar: Arc<FakeRegistrar>,
        status: SharedShortcut,
        announced: Arc<Mutex<Vec<ShortcutStatusDto>>>,
        presses: Arc<Mutex<u32>>,
    }

    fn rig() -> Rig {
        let registrar = Arc::new(FakeRegistrar::default());
        let status: SharedShortcut = Arc::new(Mutex::new(ShortcutStatusDto::Disabled));
        let announced = Arc::new(Mutex::new(Vec::new()));
        let presses = Arc::new(Mutex::new(0));
        let sink = announced.clone();
        let counter = presses.clone();
        let manager = ShortcutManager::new(
            Box::new(registrar.clone()),
            status.clone(),
            Box::new(move |s| sink.lock().unwrap().push(s)),
            Arc::new(move || *counter.lock().unwrap() += 1),
        );
        Rig {
            manager,
            registrar,
            status,
            announced,
            presses,
        }
    }

    #[test]
    fn symbols_become_plugin_accelerators() {
        assert_eq!(to_accelerator("⌃⌥⌘T"), "Ctrl+Alt+Cmd+T");
        assert_eq!(to_accelerator("⇧⌘P"), "Shift+Cmd+P");
        assert_eq!(to_accelerator("Ctrl+Alt+T"), "Ctrl+Alt+T");
        assert_eq!(to_accelerator(" ⌘K "), "Cmd+K");
    }

    #[test]
    fn the_default_shortcuts_become_valid_accelerators() {
        use application::commands::default_shortcut;
        assert_eq!(to_accelerator(default_shortcut(true)), "Ctrl+Alt+Cmd+T");
        assert_eq!(to_accelerator(default_shortcut(false)), "Ctrl+Alt+Shift+K");
    }

    #[test]
    fn the_tray_menu_only_shows_a_registered_shortcut() {
        assert_eq!(
            menu_accelerator(&ShortcutStatusDto::Registered {
                shortcut: "⌃⌥⇧K".into()
            }),
            Some("Ctrl+Alt+Shift+K".into())
        );
        assert_eq!(
            menu_accelerator(&ShortcutStatusDto::Unavailable {
                shortcut: "⌃⌥⇧K".into(),
                reason: "taken".into()
            }),
            None
        );
        assert_eq!(menu_accelerator(&ShortcutStatusDto::Disabled), None);
    }

    #[test]
    fn a_free_shortcut_is_registered_and_announced() {
        let rig = rig();
        rig.manager.apply("⌃⌥⌘T").unwrap();
        assert_eq!(
            *rig.registrar.registered.lock().unwrap(),
            vec!["Ctrl+Alt+Cmd+T".to_string()]
        );
        let expected = ShortcutStatusDto::Registered {
            shortcut: "⌃⌥⌘T".into(),
        };
        assert_eq!(*rig.status.lock().unwrap(), expected);
        assert_eq!(*rig.announced.lock().unwrap(), vec![expected]);
    }

    #[test]
    fn a_taken_shortcut_is_unavailable_with_the_reason_and_an_error() {
        let rig = rig();
        rig.registrar.take("Ctrl+Alt+Cmd+T");
        let err = rig.manager.apply("⌃⌥⌘T").unwrap_err();
        assert_eq!(
            err,
            AppError::ShortcutUnavailable {
                shortcut: "⌃⌥⌘T".into(),
                reason: "already in use by another application".into(),
            }
        );
        assert!(matches!(
            &*rig.status.lock().unwrap(),
            ShortcutStatusDto::Unavailable { shortcut, .. } if shortcut == "⌃⌥⌘T"
        ));
        assert_eq!(rig.announced.lock().unwrap().len(), 1);
        assert!(rig.registrar.registered.lock().unwrap().is_empty());
    }

    #[test]
    fn changing_the_shortcut_releases_the_previous_one() {
        let rig = rig();
        rig.manager.apply("⌃⌥⌘T").unwrap();
        rig.manager.apply("⌃⌥⌘P").unwrap();
        assert_eq!(
            *rig.registrar.registered.lock().unwrap(),
            vec!["Ctrl+Alt+Cmd+P".to_string()]
        );
    }

    #[test]
    fn a_failed_change_leaves_the_app_without_a_shortcut_but_usable() {
        let rig = rig();
        rig.manager.apply("⌃⌥⌘T").unwrap();
        rig.registrar.take("Ctrl+Alt+Cmd+P");
        assert!(rig.manager.apply("⌃⌥⌘P").is_err());
        assert!(rig.registrar.registered.lock().unwrap().is_empty());
        // Recovering by choosing a free combination works.
        rig.manager.apply("⌃⌥⌘O").unwrap();
        assert!(matches!(
            &*rig.status.lock().unwrap(),
            ShortcutStatusDto::Registered { .. }
        ));
    }

    #[test]
    fn the_press_handler_is_the_one_given_at_construction() {
        let rig = rig();
        rig.manager.apply("⌃⌥⌘T").unwrap();
        let handler = rig.registrar.handlers.lock().unwrap()[0].clone();
        handler();
        handler();
        assert_eq!(*rig.presses.lock().unwrap(), 2);
    }
}
