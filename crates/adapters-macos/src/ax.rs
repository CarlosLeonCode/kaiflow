//! Focused window title through the Accessibility API (design section 6, task 2.4).
//!
//! Every failure (no permission, no window, app not answering, timeout) maps to `None`: the
//! tracker then records the app without a title instead of dropping the segment (R2.3-R2.5).

/// Messaging timeout of every AX call, so a hung application cannot stall the sampler.
pub const MESSAGING_TIMEOUT_SECS: f32 = 0.25;

/// `AXTitle` can be empty (for example untitled windows); that is "no title", not `""`.
pub fn normalize_title(title: Option<String>) -> Option<String> {
    title.filter(|t| !t.trim().is_empty())
}

#[cfg(target_os = "macos")]
pub use mac::focused_window_title;

#[cfg(target_os = "macos")]
mod mac {
    use std::ptr::{NonNull, null};

    use objc2_application_services::{AXError, AXUIElement};
    use objc2_core_foundation::{CFRetained, CFString, CFType};

    use super::{MESSAGING_TIMEOUT_SECS, normalize_title};

    /// Title of the focused window of process `pid`; `None` on any error.
    ///
    /// The attribute names are C macros (`kAXFocusedWindowAttribute`, `kAXTitleAttribute`),
    /// which `objc2` does not bind, so the literal strings are used (phase 2 spike).
    pub fn focused_window_title(pid: i32) -> Option<String> {
        // SAFETY: `pid` is a plain integer; the call returns an owned element.
        let app = unsafe { AXUIElement::new_application(pid) };
        // SAFETY: valid element; the timeout is advisory, a failure here is not fatal.
        let _ = unsafe { app.set_messaging_timeout(MESSAGING_TIMEOUT_SECS) };

        let window = copy_attribute(&app, "AXFocusedWindow")?
            .downcast::<AXUIElement>()
            .ok()?;
        // Timeouts are per element: the window needs its own.
        // SAFETY: valid element.
        let _ = unsafe { window.set_messaging_timeout(MESSAGING_TIMEOUT_SECS) };

        let title = copy_attribute(&window, "AXTitle")?
            .downcast::<CFString>()
            .ok()?;
        normalize_title(Some(title.to_string()))
    }

    fn copy_attribute(element: &AXUIElement, name: &'static str) -> Option<CFRetained<CFType>> {
        let attribute = CFString::from_static_str(name);
        let mut out: *const CFType = null();
        // SAFETY: `out` is a valid out-pointer; on success it receives an owned (+1) CFType.
        let status = unsafe { element.copy_attribute_value(&attribute, NonNull::from(&mut out)) };
        if status != AXError::Success {
            return None;
        }
        let ptr = NonNull::new(out.cast_mut())?;
        // SAFETY: the Copy rule transferred ownership of one retain count to us.
        Some(unsafe { CFRetained::from_raw(ptr) })
    }
}

#[cfg(test)]
mod tests {
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
        let title = focused_window_title(app.processIdentifier());
        eprintln!("frontmost title: {title:?}");
    }
}
