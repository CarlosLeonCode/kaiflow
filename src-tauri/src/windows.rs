//! The three windows (design section 10), declared in code so their behavior (hidden at
//! start, hide on blur, hide instead of close) lives next to the specs. Webview pages are
//! the Vite multi-page entries `popover.html`, `main.html` and `onboarding.html`.

use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use tauri::{
    AppHandle, Manager, Monitor, PhysicalPosition, Rect, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent, Wry,
};

use crate::i18n::Messages;
use crate::ipc::dto::MainSectionDto;

pub const POPOVER: &str = "popover";
pub const MAIN: &str = "main";
pub const ONBOARDING: &str = "onboarding";

/// What a window's OS title says.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowTitle {
    /// The app name, the same in every language.
    Brand,
    /// The first-run welcome, in the interface language.
    Onboarding,
}

impl WindowTitle {
    pub fn text(self, m: &Messages) -> &'static str {
        match self {
            Self::Brand => "Kaiflow",
            Self::Onboarding => m.onboarding_window_title,
        }
    }
}

/// Static description of one window.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WindowSpec {
    pub label: &'static str,
    pub page: &'static str,
    pub title: WindowTitle,
    pub width: f64,
    pub height: f64,
    pub decorations: bool,
    pub always_on_top: bool,
    pub resizable: bool,
}

pub const POPOVER_SPEC: WindowSpec = WindowSpec {
    label: POPOVER,
    page: "popover.html",
    title: WindowTitle::Brand,
    width: 360.0,
    height: 480.0,
    decorations: false,
    always_on_top: true,
    resizable: false,
};

pub const MAIN_SPEC: WindowSpec = WindowSpec {
    label: MAIN,
    page: "main.html",
    title: WindowTitle::Brand,
    width: 1040.0,
    height: 720.0,
    decorations: true,
    always_on_top: false,
    resizable: true,
};

/// Smallest size at which the dashboard stays usable (sidebar + a readable content column).
pub const MAIN_MIN_SIZE: (f64, f64) = (760.0, 520.0);

pub const ONBOARDING_SPEC: WindowSpec = WindowSpec {
    label: ONBOARDING,
    page: "onboarding.html",
    title: WindowTitle::Onboarding,
    width: 560.0,
    height: 640.0,
    decorations: true,
    always_on_top: false,
    resizable: false,
};

/// Creates the windows hidden; `onboarding` is only created (and shown) on first run. Titles
/// use the catalog `m` of the interface language.
pub fn create_all(app: &AppHandle<Wry>, show_onboarding: bool, m: &Messages) -> tauri::Result<()> {
    let popover = build(app, &POPOVER_SPEC, m)?;
    hide_when_unfocused(&popover);
    #[cfg(target_os = "macos")]
    follow_the_active_space(&popover);
    let main = build(app, &MAIN_SPEC, m)?;
    hide_instead_of_closing(&main);
    if show_onboarding {
        let onboarding = build(app, &ONBOARDING_SPEC, m)?;
        onboarding.show()?;
        onboarding.set_focus()?;
    }
    Ok(())
}

fn build(
    app: &AppHandle<Wry>,
    spec: &WindowSpec,
    m: &Messages,
) -> tauri::Result<WebviewWindow<Wry>> {
    let builder = WebviewWindowBuilder::new(app, spec.label, WebviewUrl::App(spec.page.into()));
    // The dashboard draws its own title area: traffic lights float over the sidebar.
    #[cfg(target_os = "macos")]
    let builder = if spec.label == MAIN {
        builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
    } else {
        builder
    };
    let builder = if spec.label == MAIN {
        builder.min_inner_size(MAIN_MIN_SIZE.0, MAIN_MIN_SIZE.1)
    } else {
        builder
    };
    builder
        .title(spec.title.text(m))
        .inner_size(spec.width, spec.height)
        .decorations(spec.decorations)
        .always_on_top(spec.always_on_top)
        .resizable(spec.resizable)
        .visible(false)
        .build()
}

/// The popover opens on the Space the user is on, a full-screen app's included, instead of
/// the Space it was created on (where an end card would go unseen).
#[cfg(target_os = "macos")]
fn follow_the_active_space(window: &WebviewWindow<Wry>) {
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
    let Ok(ptr) = window.ns_window() else {
        return;
    };
    // SAFETY: windows are created in `setup`, on the main thread, and `ptr` is the live
    // NSWindow behind `window`.
    let ns_window = unsafe { &*ptr.cast::<NSWindow>() };
    ns_window.setCollectionBehavior(
        ns_window.collectionBehavior()
            | NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary,
    );
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

/// Shows the popover next to the tray icon, or hides it when already visible.
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

/// [`show_popover`] once `delay` has passed, without blocking the caller.
///
/// Showing the popover makes Kaiflow the front app, and macOS files a notification of the app
/// in front in Notification Center without a banner or its sound. It decides when it delivers
/// the notification, about 100 ms after it is posted, so the popover waits for that.
pub fn show_popover_after(app: &AppHandle<Wry>, delay: Duration) {
    if delay.is_zero() {
        show_popover(app);
        return;
    }
    let handle = app.clone();
    let spawned = std::thread::Builder::new()
        .name("popover-delay".into())
        .spawn(move || {
            std::thread::sleep(delay);
            show_popover(&handle);
        });
    if let Err(error) = spawned {
        eprintln!("could not delay the popover, opening it now: {error}");
        show_popover(app);
    }
}

fn place_and_show(window: &WebviewWindow<Wry>, tray_rect: Option<Rect>) {
    if let Some((x, y)) = popover_position(window, tray_rect) {
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
    let _ = window.show();
    let _ = window.set_focus();
}

/// Where the popover goes: next to the tray icon inside the work area of the monitor that
/// shows it, or centered on the current monitor when the tray reports no icon position
/// (Linux AppIndicator). `None` leaves the window where it is (no monitor is known).
fn popover_position(window: &WebviewWindow<Wry>, tray_rect: Option<Rect>) -> Option<(i32, i32)> {
    let scale = window.scale_factor().unwrap_or(1.0);
    let icon = tray_rect
        .map(|rect| {
            let position = rect.position.to_physical::<f64>(scale);
            let size = rect.size.to_physical::<f64>(scale);
            Area::new(position.x, position.y, size.width, size.height)
        })
        .filter(|icon| icon.width > 0.0 && icon.height > 0.0);
    match icon {
        Some(icon) => {
            let screens: Vec<Screen> = window
                .available_monitors()
                .unwrap_or_default()
                .iter()
                .map(Screen::of)
                .collect();
            Some(match screen_at(&screens, icon.center()) {
                Some(screen) => popover_origin(icon, popover_size(screen.scale), screen.work),
                // No monitor claims the icon: keep the popover under it, as before.
                None => below_icon(icon, popover_size(scale).0),
            })
        }
        None => {
            let monitor = window
                .current_monitor()
                .ok()
                .flatten()
                .or_else(|| window.primary_monitor().ok().flatten())?;
            let screen = Screen::of(&monitor);
            Some(centered_origin(popover_size(screen.scale), screen.work))
        }
    }
}

/// Popover size in physical pixels on a monitor with `scale`.
fn popover_size(scale: f64) -> (f64, f64) {
    (POPOVER_SPEC.width * scale, POPOVER_SPEC.height * scale)
}

/// A rectangle in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Area {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Area {
    const fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    fn right(&self) -> f64 {
        self.x + self.width
    }

    fn bottom(&self) -> f64 {
        self.y + self.height
    }

    fn center(&self) -> (f64, f64) {
        (self.x + self.width / 2.0, self.y + self.height / 2.0)
    }

    fn contains(&self, (x, y): (f64, f64)) -> bool {
        x >= self.x && x < self.right() && y >= self.y && y < self.bottom()
    }
}

/// One monitor: its full bounds, its work area (without the taskbar, dock or menu bar) and
/// its scale factor.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Screen {
    bounds: Area,
    work: Area,
    scale: f64,
}

impl Screen {
    fn of(monitor: &Monitor) -> Self {
        let (position, size) = (monitor.position(), monitor.size());
        let work = monitor.work_area();
        Self {
            bounds: Area::new(
                f64::from(position.x),
                f64::from(position.y),
                f64::from(size.width),
                f64::from(size.height),
            ),
            work: Area::new(
                f64::from(work.position.x),
                f64::from(work.position.y),
                f64::from(work.size.width),
                f64::from(work.size.height),
            ),
            scale: monitor.scale_factor(),
        }
    }
}

/// The monitor whose bounds contain `point` (the tray icon sits on the taskbar, outside the
/// work area, so the full bounds are what matters).
fn screen_at(screens: &[Screen], point: (f64, f64)) -> Option<&Screen> {
    screens.iter().find(|screen| screen.bounds.contains(point))
}

/// Top-left corner (physical pixels) of a popover of `size` next to the tray `icon`, always
/// inside `work`, the work area of the icon's monitor:
///
/// - icon left or right of the work area (taskbar on that side): beside the icon,
///   vertically centered on it;
/// - icon in the lower half (Windows taskbar at the bottom, the overflow flyout): above it;
/// - otherwise (macOS menu bar, a taskbar at the top): below it, centered.
fn popover_origin(icon: Area, size: (f64, f64), work: Area) -> (i32, i32) {
    let (width, height) = size;
    let (center_x, center_y) = icon.center();
    let (x, y) = if center_x < work.x {
        (icon.right(), center_y - height / 2.0)
    } else if center_x >= work.right() {
        (icon.x - width, center_y - height / 2.0)
    } else if center_y >= work.y + work.height / 2.0 {
        (center_x - width / 2.0, icon.y - height)
    } else {
        (center_x - width / 2.0, icon.bottom())
    };
    (
        clamp_start(x, work.x, work.right() - width),
        clamp_start(y, work.y, work.bottom() - height),
    )
}

/// The popover in the middle of `work` (no icon position to anchor it to).
fn centered_origin(size: (f64, f64), work: Area) -> (i32, i32) {
    let (width, height) = size;
    (
        clamp_start(
            work.x + (work.width - width) / 2.0,
            work.x,
            work.right() - width,
        ),
        clamp_start(
            work.y + (work.height - height) / 2.0,
            work.y,
            work.bottom() - height,
        ),
    )
}

/// `value` kept within `[min, max]`; when the popover is larger than the area, its top-left
/// corner stays visible (`min` wins).
fn clamp_start(value: f64, min: f64, max: f64) -> i32 {
    value.min(max).max(min).round() as i32
}

/// Centered under the icon and never left of x = 0: the placement when no monitor is known.
fn below_icon(icon: Area, width: f64) -> (i32, i32) {
    let (center_x, _) = icon.center();
    let x = (center_x - width / 2.0).max(0.0);
    (x.round() as i32, icon.bottom().round() as i32)
}

/// Hides the popover (Escape from the webview, which has no `core:window` permission).
pub fn hide_popover(app: &AppHandle<Wry>) {
    if let Some(window) = app.get_webview_window(POPOVER) {
        let _ = window.hide();
    }
}

/// Closes the onboarding window (it is created again only if onboarding is still pending).
pub fn close_onboarding(app: &AppHandle<Wry>) {
    if let Some(window) = app.get_webview_window(ONBOARDING) {
        let _ = window.close();
    }
}

/// Retitles the open windows in the language of `m` (the language setting changed). Safe
/// from any thread: the work is queued for the main thread and never waited for.
pub fn apply_language(app: &AppHandle<Wry>, m: &'static Messages) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        for spec in [POPOVER_SPEC, MAIN_SPEC, ONBOARDING_SPEC] {
            if let Some(window) = handle.get_webview_window(spec.label) {
                let _ = window.set_title(spec.title.text(m));
            }
        }
    });
}

/// The section the main window was last asked to open on, until the main window takes it.
/// A request without a section clears it, so "Open dashboard" never replays an older one.
#[derive(Debug, Default)]
pub struct PendingSection(Mutex<Option<MainSectionDto>>);

impl PendingSection {
    pub fn set(&self, section: Option<MainSectionDto>) {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = section;
    }

    pub fn take(&self) -> Option<MainSectionDto> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner).take()
    }
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
    fn a_pending_section_is_taken_once_and_cleared_by_a_plain_open() {
        let pending = PendingSection::default();
        assert_eq!(pending.take(), None);
        pending.set(Some(MainSectionDto::Goals));
        assert_eq!(pending.take(), Some(MainSectionDto::Goals));
        assert_eq!(pending.take(), None);
        pending.set(Some(MainSectionDto::Settings));
        pending.set(None);
        assert_eq!(pending.take(), None);
    }

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
    fn the_minimum_size_fits_inside_the_default_one() {
        const {
            assert!(MAIN_MIN_SIZE.0 < MAIN_SPEC.width && MAIN_MIN_SIZE.1 < MAIN_SPEC.height);
        }
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
    fn only_the_welcome_title_is_translated() {
        use crate::i18n::{EN, ES};
        assert_eq!(MAIN_SPEC.title.text(&EN), "Kaiflow");
        assert_eq!(MAIN_SPEC.title.text(&ES), "Kaiflow");
        assert_eq!(POPOVER_SPEC.title.text(&ES), "Kaiflow");
        assert_eq!(ONBOARDING_SPEC.title.text(&EN), "Welcome to Kaiflow");
        assert_eq!(
            ONBOARDING_SPEC.title.text(&ES),
            "Te damos la bienvenida a Kaiflow"
        );
    }

    /// A 1920x1080 monitor at 100 % with a 48 px taskbar on `edge`.
    fn taskbar_screen(edge: &str) -> Screen {
        let bounds = Area::new(0.0, 0.0, 1920.0, 1080.0);
        let work = match edge {
            "bottom" => Area::new(0.0, 0.0, 1920.0, 1032.0),
            "top" => Area::new(0.0, 48.0, 1920.0, 1032.0),
            "left" => Area::new(48.0, 0.0, 1872.0, 1080.0),
            "right" => Area::new(0.0, 0.0, 1872.0, 1080.0),
            _ => bounds,
        };
        Screen {
            bounds,
            work,
            scale: 1.0,
        }
    }

    const SIZE: (f64, f64) = (360.0, 480.0);

    #[test]
    fn under_the_macos_menu_bar_it_opens_below_the_icon_as_before() {
        // Menu bar 48 px tall at 2x; the work area starts below it.
        let work = Area::new(0.0, 48.0, 3024.0, 1916.0);
        let icon = Area::new(1000.0, 0.0, 40.0, 48.0);
        assert_eq!(popover_origin(icon, (720.0, 960.0), work), (660, 48));
        // Near the left edge it stays on screen.
        let icon = Area::new(10.0, 0.0, 20.0, 48.0);
        assert_eq!(popover_origin(icon, (720.0, 960.0), work), (0, 48));
    }

    #[test]
    fn a_bottom_taskbar_opens_it_above_the_icon_and_inside_the_screen() {
        let screen = taskbar_screen("bottom");
        let icon = Area::new(1000.0, 1040.0, 32.0, 32.0);
        assert_eq!(popover_origin(icon, SIZE, screen.work), (836, 552));
        // Next to the clock it does not spill past the right edge.
        let icon = Area::new(1880.0, 1040.0, 32.0, 32.0);
        assert_eq!(popover_origin(icon, SIZE, screen.work), (1560, 552));
    }

    #[test]
    fn an_icon_in_the_overflow_flyout_opens_it_above_the_icon() {
        let screen = taskbar_screen("bottom");
        let icon = Area::new(1500.0, 950.0, 32.0, 32.0);
        assert_eq!(popover_origin(icon, SIZE, screen.work), (1336, 470));
    }

    #[test]
    fn a_top_taskbar_opens_it_below_the_icon() {
        let screen = taskbar_screen("top");
        let icon = Area::new(1000.0, 8.0, 32.0, 32.0);
        assert_eq!(popover_origin(icon, SIZE, screen.work), (836, 48));
    }

    #[test]
    fn side_taskbars_open_it_beside_the_icon() {
        let icon = Area::new(8.0, 1000.0, 32.0, 32.0);
        // Centered on the icon, then pulled up to stay inside the work area.
        assert_eq!(
            popover_origin(icon, SIZE, taskbar_screen("left").work),
            (48, 600)
        );
        let icon = Area::new(1880.0, 300.0, 32.0, 32.0);
        assert_eq!(
            popover_origin(icon, SIZE, taskbar_screen("right").work),
            (1512, 76)
        );
    }

    #[test]
    fn the_icon_picks_the_monitor_that_shows_it() {
        let left = taskbar_screen("bottom");
        let right = Screen {
            bounds: Area::new(1920.0, 0.0, 2560.0, 1440.0),
            work: Area::new(1920.0, 0.0, 2560.0, 1392.0),
            scale: 1.25,
        };
        let screens = [left, right];
        assert_eq!(screen_at(&screens, (2000.0, 1420.0)), Some(&right));
        assert_eq!(screen_at(&screens, (100.0, 1050.0)), Some(&left));
        assert_eq!(screen_at(&screens, (-5.0, 10.0)), None);
        let icon = Area::new(4400.0, 1400.0, 40.0, 40.0);
        assert_eq!(
            popover_origin(icon, popover_size(right.scale), right.work),
            (4030, 792)
        );
    }

    #[test]
    fn without_an_icon_position_it_is_centered_in_the_work_area() {
        assert_eq!(
            centered_origin(SIZE, taskbar_screen("top").work),
            (780, 324)
        );
        // Larger than the area: the top-left corner stays visible.
        let tiny = Area::new(100.0, 50.0, 300.0, 400.0);
        assert_eq!(centered_origin(SIZE, tiny), (100, 50));
    }

    #[test]
    fn without_a_known_monitor_it_stays_under_the_icon() {
        let icon = Area::new(10.0, 0.0, 20.0, 24.0);
        assert_eq!(below_icon(icon, 720.0), (0, 24));
    }
}
