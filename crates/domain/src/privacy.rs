use std::collections::HashSet;

use crate::focus::FocusSnapshot;

/// Built from `settings.store_titles` plus the per-app `privacy_rules`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrivacyPolicy {
    pub store_titles: bool,
    pub excluded_apps: HashSet<String>,
    pub redacted_apps: HashSet<String>,
}

impl Default for PrivacyPolicy {
    /// Titles are stored by default (S2).
    fn default() -> Self {
        Self {
            store_titles: true,
            excluded_apps: HashSet::new(),
            redacted_apps: HashSet::new(),
        }
    }
}

/// `None` means the app is excluded and must not be recorded at all (R10.2).
/// The title is dropped when titles are globally off or the app is redacted (R10.3).
/// Applies to future snapshots only (R10.5).
pub fn apply_privacy(snapshot: FocusSnapshot, policy: &PrivacyPolicy) -> Option<FocusSnapshot> {
    if policy.excluded_apps.contains(&snapshot.app_id) {
        return None;
    }
    let drop_title = !policy.store_titles || policy.redacted_apps.contains(&snapshot.app_id);
    Some(FocusSnapshot {
        window_title: if drop_title {
            None
        } else {
            snapshot.window_title
        },
        ..snapshot
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snap(app: &str) -> FocusSnapshot {
        FocusSnapshot {
            app_id: app.into(),
            app_name: "N".into(),
            pid: 1,
            window_title: Some("secret".into()),
        }
    }

    #[test]
    fn default_policy_keeps_title() {
        let out = apply_privacy(snap("a"), &PrivacyPolicy::default()).unwrap();
        assert_eq!(out.window_title.as_deref(), Some("secret"));
    }

    #[test]
    fn excluded_app_is_dropped_entirely() {
        let mut p = PrivacyPolicy::default();
        p.excluded_apps.insert("a".into());
        assert!(apply_privacy(snap("a"), &p).is_none());
        assert!(apply_privacy(snap("b"), &p).is_some());
    }

    #[test]
    fn global_switch_and_per_app_redaction_null_the_title() {
        let global = PrivacyPolicy {
            store_titles: false,
            ..Default::default()
        };
        assert_eq!(
            apply_privacy(snap("a"), &global).unwrap().window_title,
            None
        );

        let mut per_app = PrivacyPolicy::default();
        per_app.redacted_apps.insert("a".into());
        let out = apply_privacy(snap("a"), &per_app).unwrap();
        assert_eq!((out.window_title, out.app_id.as_str()), (None, "a"));
        assert!(
            apply_privacy(snap("b"), &per_app)
                .unwrap()
                .window_title
                .is_some()
        );
    }

    #[test]
    fn exclusion_wins_over_redaction() {
        let mut p = PrivacyPolicy::default();
        p.excluded_apps.insert("a".into());
        p.redacted_apps.insert("a".into());
        assert!(apply_privacy(snap("a"), &p).is_none());
    }
}
