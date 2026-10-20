//! What a platform observer reports when the foreground application changes.

/// What the engine needs to know about an application (design section 3, `FocusSnapshot`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppIdentity {
    /// Stable application id: bundle id (macOS), executable name (Windows), `WM_CLASS`
    /// (Linux/X11). Privacy and category rules key on it.
    pub bundle_id: String,
    pub name: String,
}

/// An application became frontmost.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Activation {
    pub pid: i32,
    pub identity: AppIdentity,
    /// Native handle of the foreground window (`HWND` on Windows, X11 window id on Linux).
    /// `None` where titles are read per process (macOS Accessibility).
    pub window: Option<u64>,
}

impl Activation {
    /// An activation without a window handle (macOS).
    pub fn of_process(pid: i32, identity: AppIdentity) -> Self {
        Self {
            pid,
            identity,
            window: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_process_activation_has_no_window_handle() {
        let identity = AppIdentity {
            bundle_id: "a".into(),
            name: "A".into(),
        };
        let activation = Activation::of_process(3, identity.clone());
        assert_eq!(activation.window, None);
        assert_eq!(activation.identity, identity);
        assert_eq!(activation.pid, 3);
    }
}
