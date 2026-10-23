//! Focused window title through the Accessibility API (design section 6, task 2.4).
//!
//! Every failure (no permission, no window, app not answering, timeout) maps to a `None`
//! title: the tracker then records the app without a title instead of dropping the segment
//! (R2.3-R2.5). Each read also returns a [`TitleProbe`] (attribute path or AX error code,
//! never the title) for the diagnostics log.
//!
//! Window lookup order: `AXFocusedWindow`, then `AXMainWindow`, then the first of
//! `AXWindows`. Only `AXTitle` is read: `AXDocument` (a file path or URL) is deliberately
//! never used as a fallback, it is content, not a title.
//!
//! Electron and Chromium apps may expose an empty accessibility tree until an assistive
//! client asks for it. The fix-ups in [`next_remedy`] follow the published guidance:
//! - Electron: set `AXManualAccessibility = true` on the application element. Electron added
//!   this attribute so assistive tools can enable accessibility without the side effects of
//!   `AXEnhancedUserInterface`.
//!   <https://www.electronjs.org/docs/latest/tutorial/accessibility>
//! - Chromium-based apps listen to `AXEnhancedUserInterface` (the attribute VoiceOver sets).
//!   It is known to break window animations and positioning by window managers, so it is
//!   only a last resort: never for Apple apps, only once `AXManualAccessibility` was
//!   refused, and only after repeated failed reads.
//!   <https://developer.apple.com/forums/thread/659755>

pub use adapters_common::diagnostics::TitleProbe;

/// Messaging timeout of every AX call, so a hung application cannot stall the sampler.
/// Raised from 0.25 s: Electron/Chromium apps can take longer to answer the first query.
/// A timeout (`kAXErrorCannotComplete`) stops the lookup, so a tick waits at most once.
pub const MESSAGING_TIMEOUT_SECS: f32 = 0.5;

pub const FOCUSED_WINDOW: &str = "AXFocusedWindow";
pub const MAIN_WINDOW: &str = "AXMainWindow";
pub const WINDOWS: &str = "AXWindows";
pub const TITLE: &str = "AXTitle";
pub const MANUAL_ACCESSIBILITY: &str = "AXManualAccessibility";
pub const ENHANCED_USER_INTERFACE: &str = "AXEnhancedUserInterface";

/// Window attributes tried in order.
pub const WINDOW_ATTRIBUTES: [&str; 3] = [FOCUSED_WINDOW, MAIN_WINDOW, WINDOWS];

/// `AXError` values (HIServices/AXError.h), plain integers so the logic is testable anywhere.
pub mod codes {
    pub const SUCCESS: i32 = 0;
    pub const FAILURE: i32 = -25200;
    pub const ILLEGAL_ARGUMENT: i32 = -25201;
    pub const INVALID_UI_ELEMENT: i32 = -25202;
    pub const CANNOT_COMPLETE: i32 = -25204;
    pub const ATTRIBUTE_UNSUPPORTED: i32 = -25205;
    pub const NOT_IMPLEMENTED: i32 = -25208;
    pub const API_DISABLED: i32 = -25211;
    pub const NO_VALUE: i32 = -25212;
}

/// Symbolic name of an `AXError`, for the diagnostics log.
pub fn ax_error_label(code: i32) -> &'static str {
    match code {
        codes::SUCCESS => "kAXErrorSuccess",
        codes::FAILURE => "kAXErrorFailure",
        codes::ILLEGAL_ARGUMENT => "kAXErrorIllegalArgument",
        codes::INVALID_UI_ELEMENT => "kAXErrorInvalidUIElement",
        codes::CANNOT_COMPLETE => "kAXErrorCannotComplete",
        codes::ATTRIBUTE_UNSUPPORTED => "kAXErrorAttributeUnsupported",
        codes::NOT_IMPLEMENTED => "kAXErrorNotImplemented",
        codes::API_DISABLED => "kAXErrorAPIDisabled",
        codes::NO_VALUE => "kAXErrorNoValue",
        _ => "other",
    }
}

/// `AXTitle` can be empty (for example untitled windows); that is "no title", not `""`.
pub fn normalize_title(title: Option<String>) -> Option<String> {
    title.filter(|t| !t.trim().is_empty())
}

/// The next window attribute is worth trying after these errors (the attribute is simply
/// absent). A timeout, a disabled API or a dead element would fail the same way again.
fn tries_next_attribute(code: i32) -> bool {
    matches!(
        code,
        codes::NO_VALUE | codes::ATTRIBUTE_UNSUPPORTED | codes::FAILURE | codes::NOT_IMPLEMENTED
    )
}

/// The two AX queries the lookup needs; the macOS element in production, a fake in tests.
pub trait AxApp {
    type Window;
    /// `attribute` is one of [`WINDOW_ATTRIBUTES`]; `Err` carries the `AXError` code.
    fn window(&self, attribute: &'static str) -> Result<Self::Window, i32>;
    /// `Ok(None)` when the window has no title value.
    fn title(&self, window: &Self::Window) -> Result<Option<String>, i32>;
}

/// Title of the app's focused window (with the fallbacks above) and how it was obtained.
pub fn read_title<A: AxApp>(app: &A) -> (Option<String>, TitleProbe) {
    let mut last_error = (FOCUSED_WINDOW, codes::NO_VALUE);
    for attribute in WINDOW_ATTRIBUTES {
        match app.window(attribute) {
            Ok(window) => {
                // The first window found answers: another window's title would be wrong.
                return match app.title(&window) {
                    Ok(title) => match normalize_title(title) {
                        Some(title) => (Some(title), TitleProbe::Read { via: attribute }),
                        None => (None, TitleProbe::Empty { via: attribute }),
                    },
                    Err(code) => (None, failed(TITLE, code)),
                };
            }
            Err(code) if tries_next_attribute(code) => last_error = (attribute, code),
            Err(code) => return (None, failed(attribute, code)),
        }
    }
    (None, failed(last_error.0, last_error.1))
}

fn failed(step: &'static str, code: i32) -> TitleProbe {
    TitleProbe::Failed {
        step,
        code,
        label: ax_error_label(code),
    }
}

/// Attribute to set on an application element to expose its windows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Remedy {
    ManualAccessibility,
    EnhancedUserInterface,
}

impl Remedy {
    pub fn attribute(self) -> &'static str {
        match self {
            Self::ManualAccessibility => MANUAL_ACCESSIBILITY,
            Self::EnhancedUserInterface => ENHANCED_USER_INTERFACE,
        }
    }

    /// Static diagnostics note for the result of setting it.
    pub fn note(self, result: i32) -> &'static str {
        match (self, result) {
            (Self::ManualAccessibility, codes::SUCCESS) => "set AXManualAccessibility=true: ok",
            (Self::ManualAccessibility, codes::ATTRIBUTE_UNSUPPORTED) => {
                "set AXManualAccessibility=true: unsupported (not Electron)"
            }
            (Self::ManualAccessibility, _) => "set AXManualAccessibility=true: failed",
            (Self::EnhancedUserInterface, codes::SUCCESS) => "set AXEnhancedUserInterface=true: ok",
            (Self::EnhancedUserInterface, _) => "set AXEnhancedUserInterface=true: failed",
        }
    }
}

/// Consecutive failed reads before the `AXEnhancedUserInterface` last resort.
pub const ENHANCED_AFTER_FAILURES: u32 = 3;

/// What was tried on one process (each remedy at most once per pid).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RemedyState {
    /// Result code of setting `AXManualAccessibility`, once tried.
    pub manual: Option<i32>,
    /// Result code of setting `AXEnhancedUserInterface`, once tried.
    pub enhanced: Option<i32>,
    pub failures: u32,
}

impl RemedyState {
    pub fn applied(&mut self, remedy: Remedy, result: i32) {
        match remedy {
            Remedy::ManualAccessibility => self.manual = Some(result),
            Remedy::EnhancedUserInterface => self.enhanced = Some(result),
        }
    }
}

/// Decides whether a failed read calls for a remedy. Only "no value" and "cannot complete"
/// (the symptoms of a lazily built Electron/Chromium tree) qualify; permission errors
/// (`kAXErrorAPIDisabled`) and dead elements never do.
pub fn next_remedy(app_id: &str, probe: &TitleProbe, state: &mut RemedyState) -> Option<Remedy> {
    let TitleProbe::Failed { code, .. } = probe else {
        state.failures = 0;
        return None;
    };
    if !matches!(*code, codes::NO_VALUE | codes::CANNOT_COMPLETE) {
        return None;
    }
    state.failures = state.failures.saturating_add(1);
    if state.manual.is_none() {
        return Some(Remedy::ManualAccessibility);
    }
    let manual_refused = state.manual != Some(codes::SUCCESS);
    let eligible = manual_refused
        && state.enhanced.is_none()
        && state.failures >= ENHANCED_AFTER_FAILURES
        && !app_id.starts_with("com.apple.");
    eligible.then_some(Remedy::EnhancedUserInterface)
}

#[cfg(target_os = "macos")]
pub use mac::{focused_window_title, read_focused_title, set_app_flag};

#[cfg(target_os = "macos")]
mod mac {
    use std::ptr::{NonNull, null};

    use objc2_application_services::{AXError, AXUIElement};
    use objc2_core_foundation::{CFArray, CFBoolean, CFRetained, CFString, CFType};

    use super::{AxApp, MESSAGING_TIMEOUT_SECS, TITLE, TitleProbe, WINDOWS, codes, read_title};

    struct MacApp(CFRetained<AXUIElement>);

    fn element(pid: i32) -> CFRetained<AXUIElement> {
        // SAFETY: `pid` is a plain integer; the call returns an owned element.
        let element = unsafe { AXUIElement::new_application(pid) };
        // SAFETY: valid element; the timeout is advisory, a failure here is not fatal.
        let _ = unsafe { element.set_messaging_timeout(MESSAGING_TIMEOUT_SECS) };
        element
    }

    fn with_timeout(window: CFRetained<AXUIElement>) -> CFRetained<AXUIElement> {
        // Timeouts are per element: the window needs its own.
        // SAFETY: valid element.
        let _ = unsafe { window.set_messaging_timeout(MESSAGING_TIMEOUT_SECS) };
        window
    }

    impl AxApp for MacApp {
        type Window = CFRetained<AXUIElement>;

        fn window(&self, attribute: &'static str) -> Result<Self::Window, i32> {
            let value = copy_attribute(&self.0, attribute)?;
            if attribute == WINDOWS {
                let array = value.downcast::<CFArray>().map_err(|_| codes::FAILURE)?;
                // SAFETY: `AXWindows` is documented as an array of AXUIElements; every
                // element is still checked with `downcast` below.
                let array: CFRetained<CFArray<CFType>> =
                    unsafe { CFRetained::cast_unchecked(array) };
                let first = array.get(0).ok_or(codes::NO_VALUE)?;
                return first
                    .downcast::<AXUIElement>()
                    .map(with_timeout)
                    .map_err(|_| codes::FAILURE);
            }
            value
                .downcast::<AXUIElement>()
                .map(with_timeout)
                .map_err(|_| codes::FAILURE)
        }

        fn title(&self, window: &Self::Window) -> Result<Option<String>, i32> {
            match copy_attribute(window, TITLE) {
                Ok(value) => Ok(value.downcast::<CFString>().ok().map(|s| s.to_string())),
                Err(codes::NO_VALUE) => Ok(None),
                Err(code) => Err(code),
            }
        }
    }

    /// Title of the focused window of process `pid` and how the lookup went.
    pub fn read_focused_title(pid: i32) -> (Option<String>, TitleProbe) {
        read_title(&MacApp(element(pid)))
    }

    /// Title of the focused window of process `pid`; `None` on any error.
    pub fn focused_window_title(pid: i32) -> Option<String> {
        read_focused_title(pid).0
    }

    /// Sets a boolean attribute (`AXManualAccessibility`, `AXEnhancedUserInterface`) on the
    /// application element of `pid`; returns the `AXError` code.
    pub fn set_app_flag(pid: i32, attribute: &'static str, value: bool) -> i32 {
        let app = element(pid);
        let name = CFString::from_static_str(attribute);
        // SAFETY: valid element, attribute name and a CFBoolean value.
        let status = unsafe { app.set_attribute_value(&name, CFBoolean::new(value).as_ref()) };
        status.0
    }

    /// The attribute names are C macros (`kAXFocusedWindowAttribute`, `kAXTitleAttribute`),
    /// which `objc2` does not bind, so the literal strings are used (phase 2 spike).
    fn copy_attribute(
        element: &AXUIElement,
        name: &'static str,
    ) -> Result<CFRetained<CFType>, i32> {
        let attribute = CFString::from_static_str(name);
        let mut out: *const CFType = null();
        // SAFETY: `out` is a valid out-pointer; on success it receives an owned (+1) CFType.
        let status = unsafe { element.copy_attribute_value(&attribute, NonNull::from(&mut out)) };
        if status != AXError::Success {
            return Err(status.0);
        }
        let ptr = NonNull::new(out.cast_mut()).ok_or(codes::NO_VALUE)?;
        // SAFETY: the Copy rule transferred ownership of one retain count to us.
        Ok(unsafe { CFRetained::from_raw(ptr) })
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[test]
    fn blank_titles_are_no_title() {
        assert_eq!(normalize_title(None), None);
        assert_eq!(normalize_title(Some(String::new())), None);
        assert_eq!(normalize_title(Some("  \t".into())), None);
        assert_eq!(
            normalize_title(Some("Inbox - Mail".into())),
            Some("Inbox - Mail".into())
        );
    }

    /// Window attribute -> window id or error; window id -> title or error.
    #[derive(Default)]
    struct FakeApp {
        windows: HashMap<&'static str, Result<u32, i32>>,
        titles: HashMap<u32, Result<Option<String>, i32>>,
    }

    impl FakeApp {
        fn window(mut self, attribute: &'static str, result: Result<u32, i32>) -> Self {
            self.windows.insert(attribute, result);
            self
        }
        fn title(mut self, window: u32, result: Result<Option<&str>, i32>) -> Self {
            self.titles
                .insert(window, result.map(|t| t.map(Into::into)));
            self
        }
    }

    impl AxApp for FakeApp {
        type Window = u32;
        fn window(&self, attribute: &'static str) -> Result<u32, i32> {
            self.windows
                .get(attribute)
                .cloned()
                .unwrap_or(Err(codes::NO_VALUE))
        }
        fn title(&self, window: &u32) -> Result<Option<String>, i32> {
            self.titles.get(window).cloned().unwrap_or(Ok(None))
        }
    }

    #[test]
    fn the_focused_window_title_is_read_first() {
        let app = FakeApp::default()
            .window(FOCUSED_WINDOW, Ok(1))
            .window(MAIN_WINDOW, Ok(2))
            .title(1, Ok(Some("Focused")))
            .title(2, Ok(Some("Main")));
        assert_eq!(
            read_title(&app),
            (
                Some("Focused".into()),
                TitleProbe::Read {
                    via: FOCUSED_WINDOW
                }
            )
        );
    }

    #[test]
    fn a_missing_focused_window_falls_back_to_main_then_first_window() {
        let app = FakeApp::default()
            .window(FOCUSED_WINDOW, Err(codes::NO_VALUE))
            .window(MAIN_WINDOW, Ok(2))
            .title(2, Ok(Some("Main")));
        assert_eq!(
            read_title(&app),
            (Some("Main".into()), TitleProbe::Read { via: MAIN_WINDOW })
        );
        let app = FakeApp::default()
            .window(FOCUSED_WINDOW, Err(codes::ATTRIBUTE_UNSUPPORTED))
            .window(MAIN_WINDOW, Err(codes::NO_VALUE))
            .window(WINDOWS, Ok(3))
            .title(3, Ok(Some("First")));
        assert_eq!(
            read_title(&app),
            (Some("First".into()), TitleProbe::Read { via: WINDOWS })
        );
    }

    #[test]
    fn a_timeout_or_disabled_api_stops_the_lookup() {
        for code in [codes::CANNOT_COMPLETE, codes::API_DISABLED] {
            let app = FakeApp::default()
                .window(FOCUSED_WINDOW, Err(code))
                .window(MAIN_WINDOW, Ok(2))
                .title(2, Ok(Some("Main")));
            let (title, probe) = read_title(&app);
            assert_eq!(title, None);
            assert_eq!(
                probe,
                TitleProbe::Failed {
                    step: FOCUSED_WINDOW,
                    code,
                    label: ax_error_label(code)
                }
            );
        }
    }

    #[test]
    fn an_untitled_focused_window_is_empty_not_another_windows_title() {
        let app = FakeApp::default()
            .window(FOCUSED_WINDOW, Ok(1))
            .window(MAIN_WINDOW, Ok(2))
            .title(1, Ok(Some("  ")))
            .title(2, Ok(Some("Main")));
        assert_eq!(
            read_title(&app),
            (
                None,
                TitleProbe::Empty {
                    via: FOCUSED_WINDOW
                }
            )
        );
    }

    #[test]
    fn no_window_at_all_reports_the_last_attribute_tried() {
        let (title, probe) = read_title(&FakeApp::default());
        assert_eq!(title, None);
        assert_eq!(
            probe,
            TitleProbe::Failed {
                step: WINDOWS,
                code: codes::NO_VALUE,
                label: "kAXErrorNoValue"
            }
        );
    }

    #[test]
    fn a_title_error_is_reported_at_the_title_step() {
        let app = FakeApp::default()
            .window(FOCUSED_WINDOW, Ok(1))
            .title(1, Err(codes::CANNOT_COMPLETE));
        assert_eq!(
            read_title(&app).1,
            TitleProbe::Failed {
                step: TITLE,
                code: codes::CANNOT_COMPLETE,
                label: "kAXErrorCannotComplete"
            }
        );
    }

    #[test]
    fn probes_never_carry_the_title() {
        let app = FakeApp::default()
            .window(FOCUSED_WINDOW, Ok(1))
            .title(1, Ok(Some("Secret plans")));
        let (_, probe) = read_title(&app);
        assert!(!probe.describe().contains("Secret"));
    }

    fn no_value() -> TitleProbe {
        TitleProbe::Failed {
            step: FOCUSED_WINDOW,
            code: codes::NO_VALUE,
            label: "kAXErrorNoValue",
        }
    }

    #[test]
    fn manual_accessibility_is_tried_once_per_process() {
        let mut state = RemedyState::default();
        assert_eq!(
            next_remedy("com.electron.app", &no_value(), &mut state),
            Some(Remedy::ManualAccessibility)
        );
        state.applied(Remedy::ManualAccessibility, codes::SUCCESS);
        for _ in 0..10 {
            assert_eq!(
                next_remedy("com.electron.app", &no_value(), &mut state),
                None
            );
        }
    }

    #[test]
    fn enhanced_user_interface_is_a_late_last_resort_and_never_for_apple_apps() {
        let mut state = RemedyState::default();
        let app = "company.thebrowser.Browser";
        assert_eq!(
            next_remedy(app, &no_value(), &mut state),
            Some(Remedy::ManualAccessibility)
        );
        state.applied(Remedy::ManualAccessibility, codes::ATTRIBUTE_UNSUPPORTED);
        assert_eq!(next_remedy(app, &no_value(), &mut state), None);
        assert_eq!(
            next_remedy(app, &no_value(), &mut state),
            Some(Remedy::EnhancedUserInterface)
        );
        state.applied(Remedy::EnhancedUserInterface, codes::SUCCESS);
        assert_eq!(next_remedy(app, &no_value(), &mut state), None);

        let mut apple = RemedyState {
            manual: Some(codes::ATTRIBUTE_UNSUPPORTED),
            ..RemedyState::default()
        };
        for _ in 0..10 {
            assert_eq!(
                next_remedy("com.apple.finder", &no_value(), &mut apple),
                None
            );
        }
    }

    #[test]
    fn a_successful_read_resets_the_failure_count() {
        let mut state = RemedyState {
            manual: Some(codes::ATTRIBUTE_UNSUPPORTED),
            failures: 2,
            ..RemedyState::default()
        };
        let ok = TitleProbe::Read {
            via: FOCUSED_WINDOW,
        };
        assert_eq!(next_remedy("x", &ok, &mut state), None);
        assert_eq!(state.failures, 0);
    }

    #[test]
    fn permission_errors_never_trigger_a_remedy() {
        let mut state = RemedyState::default();
        let disabled = TitleProbe::Failed {
            step: FOCUSED_WINDOW,
            code: codes::API_DISABLED,
            label: "kAXErrorAPIDisabled",
        };
        assert_eq!(next_remedy("x", &disabled, &mut state), None);
        assert_eq!(next_remedy("x", &TitleProbe::NotTrusted, &mut state), None);
    }

    #[test]
    fn error_labels_cover_the_common_codes() {
        assert_eq!(ax_error_label(-25211), "kAXErrorAPIDisabled");
        assert_eq!(ax_error_label(-25204), "kAXErrorCannotComplete");
        assert_eq!(ax_error_label(1), "other");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_pid_that_does_not_exist_yields_none() {
        // Never panics and never blocks beyond the messaging timeout.
        assert_eq!(focused_window_title(i32::MAX), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "needs Accessibility granted to the test runner and a focused window"]
    fn reads_the_title_of_the_frontmost_app() {
        use objc2_app_kit::NSWorkspace;
        let app = NSWorkspace::sharedWorkspace()
            .frontmostApplication()
            .expect("a frontmost app");
        // Never print the title itself (AGENTS.md privacy rule): only how it was read.
        let (title, probe) = read_focused_title(app.processIdentifier());
        eprintln!(
            "frontmost: has title {}, {}",
            title.is_some(),
            probe.describe()
        );
    }
}
