//! Menu-bar icon: left click toggles the popover; the context menu offers Pause/Resume (the
//! alternative to the global shortcut, R6.3), opens the main window or quits.

use std::sync::Arc;

use application::engine::{Command, Reply};
use application::ports::TrackingKind;
use tauri::image::Image;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::composition::AppState;
use crate::windows;

/// Id of the single tray icon, used to reach it after it was built.
pub const TRAY_ID: &str = "main";

const MENU_TOGGLE: &str = "toggle-tracking";
const MENU_OPEN: &str = "open-main";
const MENU_QUIT: &str = "quit";

/// Handles the shell keeps to update the menu after the tray was built.
pub struct TrayControls {
    toggle: MenuItem<Wry>,
}

/// What the Pause/Resume entry does in each state; `None` while idle or asleep, where the
/// machine ignores it (design section 4).
pub fn toggle_command(kind: TrackingKind) -> Option<Command> {
    match kind {
        TrackingKind::Running => Some(Command::Pause),
        TrackingKind::Paused => Some(Command::Resume),
        TrackingKind::Stopped => Some(Command::Start),
        TrackingKind::Idle | TrackingKind::Asleep => None,
    }
}

/// Menu text and enabled flag for each state.
pub fn toggle_label(kind: TrackingKind) -> (&'static str, bool) {
    match kind {
        TrackingKind::Running => ("Pause tracking", true),
        TrackingKind::Paused => ("Resume tracking", true),
        TrackingKind::Stopped => ("Start tracking", true),
        TrackingKind::Idle | TrackingKind::Asleep => ("Pause tracking", false),
    }
}

/// Pause/Resume from the tray or the shortcut. Runs on its own thread: both callers sit on
/// the main thread, which must never wait for the engine (the engine may be waiting for it).
pub fn toggle_tracking(app: &AppHandle<Wry>) {
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("toggle-tracking".into())
        .spawn(move || {
            let Some(state) = app.try_state::<Arc<AppState>>() else {
                return;
            };
            let Ok(Reply::Status(status)) = state.engine.request(Command::GetStatus) else {
                return;
            };
            if let Some(command) = toggle_command(status.kind) {
                let _ = state.engine.request(command);
            }
        });
    if let Err(error) = spawned {
        eprintln!("could not start the toggle thread: {error}");
    }
}

/// Reflects the tracking state in the menu. Non-blocking: the update is queued for the main
/// thread so the engine thread never waits on it.
pub fn set_tracking_state(app: &AppHandle<Wry>, kind: TrackingKind) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(controls) = handle.try_state::<TrayControls>() {
            let (text, enabled) = toggle_label(kind);
            let _ = controls.toggle.set_text(text);
            let _ = controls.toggle.set_enabled(enabled);
        }
    });
}

/// Shows the registered global shortcut next to Pause/Resume, or removes it. Each OS draws
/// the accelerator its own way (`⌃⌥⌘T` on macOS, `Ctrl+Alt+Shift+K` on Windows); Linux
/// AppIndicator menus ignore it. Non-blocking, like `set_tracking_state`.
pub fn set_shortcut_hint(app: &AppHandle<Wry>, accelerator: Option<String>) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(controls) = handle.try_state::<TrayControls>()
            && let Err(error) = controls.toggle.set_accelerator(accelerator.as_deref())
        {
            eprintln!("could not show the shortcut in the tray menu: {error}");
        }
    });
}

/// The ensō mark as a template image (black on transparent, 36 px = 18 pt @2x): macOS tints
/// it for light and dark menu bars. Built from `assets/brand/kaiflow-mark-mono.svg`.
#[cfg(target_os = "macos")]
const ICON: &[u8] = include_bytes!("../icons/tray-template.png");
/// Windows and Linux trays do not tint template images, so they get the full-color app icon,
/// which stays visible on both light and dark taskbars and panels.
#[cfg(not(target_os = "macos"))]
const ICON: &[u8] = include_bytes!("../icons/64x64.png");

/// Template rendering only makes sense where the OS recolors the icon (the macOS menu bar).
const ICON_AS_TEMPLATE: bool = cfg!(target_os = "macos");

pub fn install(app: &AppHandle<Wry>) -> tauri::Result<()> {
    let (text, enabled) = toggle_label(TrackingKind::Stopped);
    let toggle = MenuItem::with_id(app, MENU_TOGGLE, text, enabled, None::<&str>)?;
    let open = MenuItem::with_id(app, MENU_OPEN, "Open Kaiflow", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&toggle, &open, &PredefinedMenuItem::separator(app)?, &quit],
    )?;
    app.manage(TrayControls { toggle });

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(ICON)?)
        .icon_as_template(ICON_AS_TEMPLATE)
        .tooltip("Kaiflow")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu_event)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                windows::toggle_popover(tray.app_handle(), Some(rect));
            }
        })
        .build(app)?;
    Ok(())
}

fn on_menu_event(app: &AppHandle<Wry>, event: MenuEvent) {
    match event.id().as_ref() {
        MENU_TOGGLE => toggle_tracking(app),
        MENU_OPEN => windows::show_main(app),
        MENU_QUIT => app.exit(0),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_entry_pauses_resumes_or_starts_depending_on_the_state() {
        assert_eq!(toggle_command(TrackingKind::Running), Some(Command::Pause));
        assert_eq!(toggle_command(TrackingKind::Paused), Some(Command::Resume));
        assert_eq!(toggle_command(TrackingKind::Stopped), Some(Command::Start));
        assert_eq!(toggle_command(TrackingKind::Idle), None);
        assert_eq!(toggle_command(TrackingKind::Asleep), None);
    }

    #[test]
    fn labels_match_the_action_and_idle_or_asleep_disable_the_entry() {
        assert_eq!(
            toggle_label(TrackingKind::Running),
            ("Pause tracking", true)
        );
        assert_eq!(
            toggle_label(TrackingKind::Paused),
            ("Resume tracking", true)
        );
        assert_eq!(
            toggle_label(TrackingKind::Stopped),
            ("Start tracking", true)
        );
        assert!(!toggle_label(TrackingKind::Idle).1);
        assert!(!toggle_label(TrackingKind::Asleep).1);
    }
}
