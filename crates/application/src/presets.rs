//! Opt-in presets and app suggestions (use cases around `domain::presets`).
//!
//! Nothing here runs by itself: a pack is applied only when the user picks it, and a
//! suggestion becomes an app rule only when accepted. History is classified when it is read,
//! so creating a rule reclassifies past time without rewriting any segment.

use std::sync::Arc;

use domain::presets::{self, Preset, PresetActivity, match_in_pack};
use domain::{Activity, ActivityId, ActivityRule, RuleKind, SeenApp};

use crate::commands::CommandError;
use crate::ports::{ActivityRepository, ReportRepository, SettingsRepository};
use crate::settings_blobs::{KEY_SUGGESTIONS, SuggestionSettings, read_blob, write_blob};

/// What applying a pack changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ApplyOutcome {
    pub activities_created: u32,
    pub rules_created: u32,
}

/// A suggestion shown to the user: an app and the activity it would be filed under.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SuggestionView {
    pub app_id: String,
    pub app_name: String,
    pub pack_key: &'static str,
    pub activity_key: &'static str,
    pub activity_name: &'static str,
    /// The existing activity this resolves to; `None` when accepting would create it.
    pub activity_id: Option<ActivityId>,
}

pub struct PresetService {
    activities: Arc<dyn ActivityRepository>,
    reports: Arc<dyn ReportRepository>,
    settings: Arc<dyn SettingsRepository>,
}

impl PresetService {
    pub fn new(
        activities: Arc<dyn ActivityRepository>,
        reports: Arc<dyn ReportRepository>,
        settings: Arc<dyn SettingsRepository>,
    ) -> Self {
        Self {
            activities,
            reports,
            settings,
        }
    }

    /// The catalog; read-only, never selected.
    pub fn packs(&self) -> &'static [Preset] {
        presets::PRESETS
    }

    /// Creates the pack's activities (skipping those that already exist) and an app rule for
    /// every app already in the history that the pack recognises and no rule covers yet.
    /// Running it twice changes nothing the second time.
    pub fn apply(&self, pack_key: &str) -> Result<ApplyOutcome, CommandError> {
        let pack = presets::preset(pack_key).ok_or(CommandError::NotFound)?;
        let mut outcome = ApplyOutcome::default();
        let mut resolved = Vec::with_capacity(pack.activities.len());
        for wanted in pack.activities {
            let (activity, created) = self.find_or_create(wanted)?;
            outcome.activities_created += u32::from(created);
            resolved.push((wanted, activity.id));
        }

        let mut rules = self.activities.list_rules()?;
        for app in self.reports.seen_apps()? {
            if presets::has_rule_for(&app.app_id, &rules) {
                continue;
            }
            let Some(matched) = match_in_pack(pack, &app.app_id, &app.app_name) else {
                continue;
            };
            let Some((_, activity_id)) = resolved.iter().find(|(w, _)| w.key == matched.key) else {
                continue;
            };
            let mut rule = app_rule(*activity_id, &app.app_id);
            rule.id = self.activities.save_rule(&rule)?;
            rules.push(rule);
            outcome.rules_created += 1;
        }
        Ok(outcome)
    }

    /// Suggestions for apps in the history that no rule covers, minus the dismissed ones.
    pub fn suggestions(&self) -> Result<Vec<SuggestionView>, CommandError> {
        let rules = self.activities.list_rules()?;
        let dismissed: SuggestionSettings = read_blob(&*self.settings, KEY_SUGGESTIONS)?;
        let seen = self.reports.seen_apps()?;
        let existing = self.activities.list()?;
        Ok(
            presets::suggestions(&seen, &rules, &dismissed.dismissed_apps)
                .into_iter()
                .map(|s| SuggestionView {
                    activity_id: find_existing(&existing, s.activity).map(|a| a.id),
                    app_id: s.app_id,
                    app_name: s.app_name,
                    pack_key: s.pack_key,
                    activity_key: s.activity.key,
                    activity_name: s.activity.name,
                })
                .collect(),
        )
    }

    /// Remembers the dismissal; no rule is created and the suggestion never returns.
    pub fn dismiss(&self, app_id: &str) -> Result<(), CommandError> {
        let app_id = app_id.trim();
        if app_id.is_empty() || app_id.len() > 256 {
            return Err(CommandError::Invalid("invalid app id".into()));
        }
        let mut blob: SuggestionSettings = read_blob(&*self.settings, KEY_SUGGESTIONS)?;
        blob.dismiss(app_id);
        Ok(write_blob(&*self.settings, KEY_SUGGESTIONS, &blob)?)
    }

    /// Files the app under its suggested activity (created on the spot if it does not exist
    /// yet) with an app rule. No-op when a rule already covers the app.
    pub fn accept(&self, app_id: &str) -> Result<(), CommandError> {
        let app = self
            .reports
            .seen_apps()?
            .into_iter()
            .find(|a: &SeenApp| a.app_id == app_id)
            .ok_or(CommandError::NotFound)?;
        let (_, wanted) =
            presets::suggest(&app.app_id, &app.app_name).ok_or(CommandError::NotFound)?;
        if presets::has_rule_for(&app.app_id, &self.activities.list_rules()?) {
            return Ok(());
        }
        let (activity, _) = self.find_or_create(wanted)?;
        self.activities
            .save_rule(&app_rule(activity.id, &app.app_id))?;
        Ok(())
    }

    fn find_or_create(&self, wanted: &PresetActivity) -> Result<(Activity, bool), CommandError> {
        if let Some(found) = find_existing(&self.activities.list()?, wanted) {
            return Ok((found, false));
        }
        let created = self.activities.create_with_preset(
            wanted.name,
            wanted.color,
            wanted.productivity,
            wanted.key,
        )?;
        Ok((created, true))
    }
}

/// An activity already standing for `wanted`: same preset key, or the same name typed by hand.
fn find_existing(existing: &[Activity], wanted: &PresetActivity) -> Option<Activity> {
    existing
        .iter()
        .find(|a| a.preset_key.as_deref() == Some(wanted.key))
        .or_else(|| {
            existing
                .iter()
                .find(|a| a.name.eq_ignore_ascii_case(wanted.name))
        })
        .cloned()
}

fn app_rule(activity_id: ActivityId, app_id: &str) -> ActivityRule {
    ActivityRule {
        id: 0,
        activity_id,
        kind: RuleKind::App(app_id.to_owned()),
        priority: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fakes::{FakeActivities, FakeSettings, FakeStore};
    use domain::{Productivity, UtcMs};

    struct Rig {
        service: PresetService,
        activities: FakeActivities,
        settings: FakeSettings,
    }

    fn rig(apps: &[(&str, &str)]) -> Rig {
        let store = FakeStore::default();
        for (i, (id, name)) in apps.iter().enumerate() {
            let at = i as i64 * 10;
            store.seed_segment(domain::Segment {
                id: domain::SegmentId(0),
                started_at: UtcMs(at),
                ended_at: Some(UtcMs(at + 5)),
                heartbeat_at: UtcMs(at + 5),
                app_id: Some((*id).into()),
                app_name: Some((*name).into()),
                window_title: None,
                end_reason: None,
                source: domain::SegmentSource::Tracked,
                activity_id: None,
            });
        }
        let activities = FakeActivities::default();
        let settings = FakeSettings::default();
        let service = PresetService::new(
            Arc::new(activities.clone()),
            Arc::new(store),
            Arc::new(settings.clone()),
        );
        Rig {
            service,
            activities,
            settings,
        }
    }

    fn rule_apps(rig: &Rig) -> Vec<String> {
        rig.activities
            .list_rules()
            .unwrap()
            .into_iter()
            .filter_map(|r| match r.kind {
                RuleKind::App(a) => Some(a),
                RuleKind::TitlePattern { .. } => None,
            })
            .collect()
    }

    #[test]
    fn applying_creates_activities_with_preset_keys_and_rules_only_for_seen_apps() {
        let rig = rig(&[
            ("com.figma.Desktop", "Figma"),
            ("com.microsoft.VSCode", "Code"),
        ]);
        let outcome = rig.service.apply("design").unwrap();
        assert_eq!(
            outcome,
            ApplyOutcome {
                activities_created: 2,
                rules_created: 1
            }
        );
        let created = rig.activities.list().unwrap();
        assert_eq!(created.len(), 2);
        assert!(created.iter().all(|a| a.preset_key.is_some()));
        assert_eq!(
            rule_apps(&rig),
            ["com.figma.Desktop"],
            "VS Code is not a design app"
        );
    }

    #[test]
    fn applying_twice_is_idempotent() {
        let rig = rig(&[("com.figma.Desktop", "Figma")]);
        rig.service.apply("design").unwrap();
        let again = rig.service.apply("design").unwrap();
        assert_eq!(again, ApplyOutcome::default());
        assert_eq!(rig.activities.list().unwrap().len(), 2);
        assert_eq!(rig.activities.list_rules().unwrap().len(), 1);
    }

    #[test]
    fn a_hand_made_activity_with_the_same_name_is_reused() {
        let rig = rig(&[("com.figma.Desktop", "Figma")]);
        let mine = rig
            .activities
            .create("design tools", "#000000", Productivity::Neutral)
            .unwrap();
        let outcome = rig.service.apply("design").unwrap();
        assert_eq!(outcome.activities_created, 1, "only Video & motion is new");
        assert_eq!(rig.activities.list_rules().unwrap()[0].activity_id, mine.id);
    }

    #[test]
    fn an_app_that_already_has_a_rule_is_left_alone() {
        let rig = rig(&[("com.figma.Desktop", "Figma")]);
        let other = rig
            .activities
            .create("Mine", "#000000", Productivity::Neutral)
            .unwrap();
        rig.activities
            .save_rule(&app_rule(other.id, "com.figma.Desktop"))
            .unwrap();
        assert_eq!(rig.service.apply("design").unwrap().rules_created, 0);
    }

    #[test]
    fn unknown_pack_is_not_found() {
        let rig = rig(&[]);
        assert_eq!(rig.service.apply("nope"), Err(CommandError::NotFound));
    }

    #[test]
    fn nothing_exists_until_the_user_acts() {
        let rig = rig(&[("com.figma.Desktop", "Figma")]);
        assert!(!rig.service.packs().is_empty());
        assert!(rig.activities.list().unwrap().is_empty());
        assert!(rig.activities.list_rules().unwrap().is_empty());
    }

    #[test]
    fn suggestions_cover_unassigned_apps_without_applying_anything() {
        let rig = rig(&[
            ("com.google.Chrome", "Chrome"),
            ("com.unknown.tool", "Mystery"),
        ]);
        let list = rig.service.suggestions().unwrap();
        assert_eq!(list.len(), 1, "no match, no suggestion");
        assert_eq!(list[0].activity_name, "Browsing");
        assert_eq!(list[0].activity_id, None);
        assert!(rig.activities.list_rules().unwrap().is_empty());
        assert!(rig.activities.list().unwrap().is_empty());
    }

    #[test]
    fn accepting_creates_the_rule_and_the_suggestion_disappears() {
        let rig = rig(&[("com.google.Chrome", "Chrome")]);
        rig.service.accept("com.google.Chrome").unwrap();
        assert_eq!(rule_apps(&rig), ["com.google.Chrome"]);
        let activity = &rig.activities.list().unwrap()[0];
        assert_eq!(activity.name, "Browsing");
        assert_eq!(activity.preset_key.as_deref(), Some("general.browsing"));
        assert!(rig.service.suggestions().unwrap().is_empty());
        // Accepting again changes nothing.
        rig.service.accept("com.google.Chrome").unwrap();
        assert_eq!(rig.activities.list_rules().unwrap().len(), 1);
    }

    #[test]
    fn accepting_an_unsuggestable_app_is_not_found() {
        let rig = rig(&[("com.unknown.tool", "Mystery")]);
        assert_eq!(
            rig.service.accept("com.unknown.tool"),
            Err(CommandError::NotFound)
        );
        assert_eq!(
            rig.service.accept("never.seen"),
            Err(CommandError::NotFound)
        );
    }

    #[test]
    fn dismissing_persists_and_creates_no_rule() {
        let rig = rig(&[("com.google.Chrome", "Chrome")]);
        rig.service.dismiss("com.google.Chrome").unwrap();
        assert!(rig.service.suggestions().unwrap().is_empty());
        assert!(rig.activities.list_rules().unwrap().is_empty());
        let stored = rig.settings.get(KEY_SUGGESTIONS).unwrap().unwrap();
        assert!(stored.contains("com.google.Chrome"));
        assert!(rig.service.dismiss("  ").is_err());
    }
}
