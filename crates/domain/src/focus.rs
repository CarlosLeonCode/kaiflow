/// What the user is looking at right now, as reported by a window provider.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FocusSnapshot {
    /// Bundle id.
    pub app_id: String,
    pub app_name: String,
    pub pid: i32,
    pub window_title: Option<String>,
}

impl FocusSnapshot {
    /// Focus equality is `(app_id, window_title)` (R1.3); pid and name are ignored.
    pub fn same_focus(&self, other: &FocusSnapshot) -> bool {
        self.app_id == other.app_id && self.window_title == other.window_title
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snap(app: &str, pid: i32, title: Option<&str>) -> FocusSnapshot {
        FocusSnapshot {
            app_id: app.into(),
            app_name: app.into(),
            pid,
            window_title: title.map(Into::into),
        }
    }

    #[test]
    fn same_app_and_title_is_same_focus_regardless_of_pid() {
        assert!(snap("a", 1, Some("t")).same_focus(&snap("a", 2, Some("t"))));
    }

    #[test]
    fn title_or_app_change_is_a_new_focus() {
        assert!(!snap("a", 1, Some("t")).same_focus(&snap("a", 1, Some("u"))));
        assert!(!snap("a", 1, None).same_focus(&snap("b", 1, None)));
    }
}
