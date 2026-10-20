//! The three windows (design section 10), declared in code so their behavior (hidden at
//! start, hide on blur, hide instead of close) lives next to the specs. Webview pages are
//! the Vite multi-page entries `popover.html`, `main.html` and `onboarding.html`.

use tauri::{
    AppHandle, Manager, PhysicalPosition, Rect, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent, Wry,
};

pub const POPOVER: &str = "popover";
pub const MAIN: &str = "main";
pub const ONBOARDING: &str = "onboarding";

/// Static description of one window.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WindowSpec {
    pub label: &'static str,
    pub page: &'static str,
    pub title: &'static str,
    pub width: f64,
    pub height: f64,
    pub decorations: bool,
    pub always_on_top: bool,
    pub resizable: bool,
}

pub const POPOVER_SPEC: WindowSpec = WindowSpec {
    label: POPOVER,
    page: "popover.html",
    title: "Time Track Copilot",
    width: 360.0,
    height: 480.0,
    decorations: false,
    always_on_top: true,
    resizable: false,
};

pub const MAIN_SPEC: WindowSpec = WindowSpec {
    label: MAIN,
    page: "main.html",
    title: "Time Track Copilot",
    width: 1040.0,
    height: 720.0,
    decorations: true,
    always_on_top: false,
    resizable: true,
};

pub const ONBOARDING_SPEC: WindowSpec = WindowSpec {
    label: ONBOARDING,
    page: "onboarding.html",
    title: "Welcome to Time Track Copilot",
    width: 560.0,
    height: 640.0,
    decorations: true,
    always_on_top: false,
    resizable: false,
};

/// Creates the windows hidden; `onboarding` is only created (and shown) on first run.
pub fn create_all(app: &AppHandle<Wry>, show_onboarding: bool) -> tauri::Result<()> {
    let popover = build(app, &POPOVER_SPEC)?;
    hide_when_unfocused(&popover);
    let main = build(app, &MAIN_SPEC)?;
    hide_instead_of_closing(&main);
    if show_onboarding {
        let onboarding = build(app, &ONBOARDING_SPEC)?;
        onboarding.show()?;
        onboarding.set_focus()?;
    }
    Ok(())
}

fn build(app: &AppHandle<Wry>, spec: &WindowSpec) -> tauri::Result<WebviewWindow<Wry>> {
    WebviewWindowBuilder::new(app, spec.label, WebviewUrl::App(spec.page.into()))
        .title(spec.title)
        .inner_size(spec.width, spec.height)
        .decorations(spec.decorations)
        .always_on_top(spec.always_on_top)
        .resizable(spec.resizable)
        .visible(false)
        .build()
}

fn hide_when_unfocused(window: &WebviewWindow<Wry>) {
    let target = window.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Focused(false)) {
            let _ = target.hide();
        }
    });
}

/// Closing the main window keeps the app alive in the menu bar.
fn hide_instead_of_closing(window: &WebviewWindow<Wry>) {
    let target = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = target.hide();
        }
    });
}

/// Shows the popover under the tray icon, or hides it when already visible.
pub fn toggle_popover(app: &AppHandle<Wry>, tray_rect: Option<Rect>) {
    let Some(window) = app.get_webview_window(POPOVER) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }
    place_and_show(&window, tray_rect);
}

/// Opens the popover without toggling (idle-return card, notification click). Safe to call
/// from any thread: the work is queued for the main thread and never waited for.
pub fn show_popover(app: &AppHandle<Wry>) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(window) = handle.get_webview_window(POPOVER) else {
            return;
        };
        let rect = handle
            .tray_by_id("main")
            .and_then(|tray| tray.rect().ok().flatten());
        place_and_show(&window, rect);
    });
}

fn place_and_show(window: &WebviewWindow<Wry>, tray_rect: Option<Rect>) {
    if let Some(rect) = tray_rect {
        let scale = window.scale_factor().unwrap_or(1.0);
        let icon_pos = rect.position.to_physical::<f64>(scale);
        let icon_size = rect.size.to_physical::<f64>(scale);
        let width = POPOVER_SPEC.width * scale;
        let (x, y) = popover_origin(
            icon_pos.x,
            icon_pos.y,
            icon_size.width,
            icon_size.height,
            width,
        );
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
    let _ = window.show();
    let _ = window.set_focus();
}

/// Top-left corner (physical pixels) that centers a window of `width` under the tray icon.
fn popover_origin(icon_x: f64, icon_y: f64, icon_w: f64, icon_h: f64, width: f64) -> (i32, i32) {
    let x = (icon_x + icon_w / 2.0 - width / 2.0).max(0.0);
    (x.round() as i32, (icon_y + icon_h).round() as i32)
}

/// Opens (and focuses) the main window, e.g. from the popover or the tray menu.
pub fn show_main(app: &AppHandle<Wry>) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_follow_the_design() {
        assert_eq!((POPOVER_SPEC.width, POPOVER_SPEC.height), (360.0, 480.0));
        assert_eq!((MAIN_SPEC.width, MAIN_SPEC.height), (1040.0, 720.0));
        assert_eq!(
            (ONBOARDING_SPEC.width, ONBOARDING_SPEC.height),
            (560.0, 640.0)
        );
    }

    #[test]
    fn only_the_popover_is_frameless_and_floating() {
        const {
            assert!(!POPOVER_SPEC.decorations && POPOVER_SPEC.always_on_top);
            assert!(MAIN_SPEC.decorations && !MAIN_SPEC.always_on_top);
            assert!(ONBOARDING_SPEC.decorations && !ONBOARDING_SPEC.always_on_top);
        }
    }

    #[test]
    fn labels_match_the_capability_files() {
        for spec in [POPOVER_SPEC, MAIN_SPEC, ONBOARDING_SPEC] {
            assert_eq!(spec.page, format!("{}.html", spec.label));
        }
    }

    #[test]
    fn popover_is_centered_under_the_icon_and_kept_on_screen() {
        assert_eq!(popover_origin(1000.0, 0.0, 40.0, 24.0, 720.0), (660, 24));
        assert_eq!(popover_origin(10.0, 0.0, 20.0, 24.0, 720.0), (0, 24));
    }
}
