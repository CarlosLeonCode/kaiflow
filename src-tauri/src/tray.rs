//! Menu-bar icon: left click toggles the popover, the context menu opens the main window
//! or quits. Pause/Resume entries join the menu with the shortcuts work (task 2.7).

use tauri::image::Image;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Wry};

use crate::windows;

const MENU_OPEN: &str = "open-main";
const MENU_QUIT: &str = "quit";

/// Monochrome so macOS can tint it for light and dark menu bars. Variants for
/// recording / paused / degraded arrive with the status wiring.
const ICON: &[u8] = include_bytes!("../icons/tray-template.png");

pub fn install(app: &AppHandle<Wry>) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, MENU_OPEN, "Open Time Track", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &PredefinedMenuItem::separator(app)?, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(Image::from_bytes(ICON)?)
        .icon_as_template(true)
        .tooltip("Time Track Copilot")
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
        MENU_OPEN => windows::show_main(app),
        MENU_QUIT => app.exit(0),
        _ => {}
    }
}
