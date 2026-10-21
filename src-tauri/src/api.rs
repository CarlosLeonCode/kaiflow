//! Use cases behind the IPC commands, expressed on `AppState` and returning DTOs. Keeping
//! them free of Tauri types makes them testable with a temp database (see tests below).

use std::path::Path;
use std::sync::PoisonError;

use application::commands::ConfirmToken;
use application::engine::{Command, Reply};
use application::export::ScheduledBackup;
use domain::{Activity, ActivityId, GapId};

use crate::calendar::timezone_label;
use crate::composition::AppState;
use crate::error::AppError;
use crate::ipc::dto::{
    ActivityDto, ApplyPresetResultDto, BackupReportDto, BackupStatusDto, DashboardDto, DeleteOpDto,
    GoalDto, GoalStatusDto, IdleGapDto, IdleResolutionDto, PermissionStateDto, PresetDto,
    PrivacyModeDto, PrivacyRulesDto, ProductivityDto, RangeDto, ReportDto, RestorePreviewDto,
    RestoreResultDto, RetentionImpactDto, RuleDto, RuleInputDto, SettingsDto, SettingsPatchDto,
    ShortcutStatusDto, SuggestionDto, TimelineItemDto, TrackingStateDto, TrackingStatusDto,
};

impl AppState {
    fn shortcut_status(&self) -> ShortcutStatusDto {
        self.shortcut
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    fn status_after(&self, command: Command) -> Result<TrackingStatusDto, AppError> {
        match self.engine.request(command)? {
            Reply::Status(status) => Ok(TrackingStatusDto::new(
                status,
                self.shortcut_status(),
                self.permission.degraded_reason().into(),
            )),
            other => Err(AppError::Internal {
                message: format!("unexpected engine reply: {other:?}"),
            }),
        }
    }

    pub fn get_status(&self) -> Result<TrackingStatusDto, AppError> {
        self.status_after(Command::GetStatus)
    }

    pub fn start(&self) -> Result<TrackingStatusDto, AppError> {
        self.status_after(Command::Start)
    }

    pub fn pause(&self) -> Result<TrackingStatusDto, AppError> {
        self.status_after(Command::Pause)
    }

    pub fn resume(&self) -> Result<TrackingStatusDto, AppError> {
        self.status_after(Command::Resume)
    }

    pub fn stop(&self) -> Result<TrackingStatusDto, AppError> {
        self.status_after(Command::Stop)
    }

    pub fn get_report(
        &self,
        range: RangeDto,
        buckets: Vec<RangeDto>,
    ) -> Result<ReportDto, AppError> {
        let buckets: Vec<_> = buckets.into_iter().map(Into::into).collect();
        let report = self
            .queries
            .range_report(range.into(), &buckets, self.now())?;
        Ok(report.into())
    }

    /// Everything the Overview shows for `range`, with one load that also covers `previous`.
    pub fn get_dashboard(
        &self,
        range: RangeDto,
        buckets: Vec<RangeDto>,
        previous: Option<RangeDto>,
    ) -> Result<DashboardDto, AppError> {
        let buckets: Vec<_> = buckets.into_iter().map(Into::into).collect();
        let dashboard = self.queries.dashboard(
            range.into(),
            &buckets,
            previous.map(Into::into),
            &self.calendar,
            self.now(),
        )?;
        let goals = self.goals.statuses(self.now())?;
        Ok(DashboardDto::new(dashboard, goals))
    }

    pub fn get_timeline(&self, range: RangeDto) -> Result<Vec<TimelineItemDto>, AppError> {
        let items = self.queries.timeline(range.into(), self.now())?;
        Ok(items.into_iter().map(Into::into).collect())
    }

    /// Writes the JSON export of a range to `path` (chosen in a native dialog by the command
    /// layer). The file appears complete or not at all.
    pub fn export_json_to(&self, path: &Path, range: RangeDto) -> Result<(), AppError> {
        Ok(self
            .data
            .export_to(path, range.into(), self.now(), &timezone_label())?)
    }

    pub fn backup_status(&self) -> Result<BackupStatusDto, AppError> {
        Ok(self.data.backup_status()?.into())
    }

    pub fn backup_set_enabled(&self, enabled: bool) -> Result<BackupStatusDto, AppError> {
        self.data.set_backup_enabled(enabled)?;
        self.backup_status()
    }

    /// `None` goes back to the default folder.
    pub fn backup_set_dir(&self, dir: Option<&str>) -> Result<BackupStatusDto, AppError> {
        self.data.set_backup_dir(dir)?;
        self.backup_status()
    }

    pub fn backup_now(&self) -> Result<BackupReportDto, AppError> {
        Ok(self.data.backup_now(self.now(), &timezone_label())?.into())
    }

    /// The scheduled check run by the backup worker.
    pub fn run_scheduled_backup(&self) -> Result<ScheduledBackup, AppError> {
        Ok(self
            .data
            .run_scheduled_backup(self.now(), &timezone_label())?)
    }

    /// Reads a backup or export file and previews it; nothing is modified.
    pub fn restore_prepare_file(&self, path: &Path) -> Result<RestorePreviewDto, AppError> {
        let preview = self.data.restore_prepare_file(path, self.now())?;
        let name = path
            .file_name()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
        Ok(RestorePreviewDto::new(preview, name))
    }

    /// Replaces all data with the previewed file. Tracking stops first (the open segment
    /// would otherwise be replaced underneath the engine) and picks up again afterwards if it
    /// was running; the engine then reloads what it caches and the live settings are re-applied.
    pub fn restore_apply(&self, token: String) -> Result<RestoreResultDto, AppError> {
        let was_running = self.get_status()?.state == TrackingStateDto::Running;
        self.engine.request(Command::Stop)?;
        let outcome = self.data.restore_apply(&token, self.now());
        if outcome.is_ok() {
            self.engine.request(Command::ReloadPrivacy)?;
            self.reapply_live_settings();
        }
        if was_running {
            self.start()?;
        }
        Ok(outcome?.into())
    }

    /// Pushes the stored settings into the live handles after the database was replaced.
    fn reapply_live_settings(&self) {
        let Ok(settings) = self.commands.get_settings() else {
            return;
        };
        self.idle_threshold.set(settings.idle_threshold_secs);
        self.idle_policy.set(
            settings.idle_prompt_timeout_secs,
            settings.idle_auto_discard_below_secs,
        );
        if let Some(applier) = self.applier() {
            applier.refresh_tray_text();
            // Goals and the week start came with the restored data.
            applier.refresh_goals();
        }
    }

    /// What purging data older than `days` days would delete, for the confirmation.
    pub fn retention_impact(&self, days: u32) -> Result<RetentionImpactDto, AppError> {
        Ok(self.commands.retention_impact(days, self.now())?.into())
    }

    pub fn goals_list(&self) -> Result<Vec<GoalDto>, AppError> {
        Ok(self.goals.list()?.into_iter().map(Into::into).collect())
    }

    /// Creates (`id <= 0`) or updates a goal, then asks the watcher and the tray to look again.
    pub fn goals_upsert(&self, goal: GoalDto) -> Result<GoalDto, AppError> {
        let saved = self.goals.save(goal.into(), self.now())?;
        self.refresh_goal_views();
        Ok(saved.into())
    }

    pub fn goals_delete(&self, id: i64) -> Result<(), AppError> {
        self.goals.delete(id)?;
        self.refresh_goal_views();
        Ok(())
    }

    /// Progress and streak of every active goal: what the popover, Today and Overview show.
    pub fn goals_status(&self) -> Result<Vec<GoalStatusDto>, AppError> {
        Ok(self
            .goals
            .statuses(self.now())?
            .into_iter()
            .map(Into::into)
            .collect())
    }

    /// The user saw the badge of a goal.
    pub fn goal_events_mark_seen(&self, goal_id: i64) -> Result<(), AppError> {
        Ok(self.goals.mark_seen(goal_id)?)
    }

    fn refresh_goal_views(&self) {
        if let Some(applier) = self.applier() {
            applier.refresh_goals();
            applier.refresh_tray_text();
        }
    }

    pub fn list_pending_idle_gaps(&self) -> Result<Vec<IdleGapDto>, AppError> {
        match self.engine.request(Command::ListPendingGaps)? {
            Reply::PendingGaps(gaps) => {
                Ok(gaps.into_iter().filter_map(IdleGapDto::from_gap).collect())
            }
            other => Err(AppError::Internal {
                message: format!("unexpected engine reply: {other:?}"),
            }),
        }
    }

    pub fn resolve_idle_gap(&self, id: i64, resolution: IdleResolutionDto) -> Result<(), AppError> {
        self.engine.request(Command::ResolveGap {
            id: GapId(id),
            resolution: resolution.into(),
        })?;
        Ok(())
    }

    pub fn activities_list(&self) -> Result<Vec<ActivityDto>, AppError> {
        Ok(self
            .activities
            .list()?
            .into_iter()
            .map(Into::into)
            .collect())
    }

    pub fn activities_create(
        &self,
        name: &str,
        color: &str,
        productivity: ProductivityDto,
    ) -> Result<ActivityDto, AppError> {
        Ok(self
            .commands
            .create_activity(name, color, productivity.into())?
            .into())
    }

    pub fn activities_update(&self, activity: ActivityDto) -> Result<(), AppError> {
        Ok(self.commands.update_activity(&Activity::from(activity))?)
    }

    pub fn activities_delete(&self, id: i64) -> Result<(), AppError> {
        Ok(self.commands.delete_activity(ActivityId(id))?)
    }

    pub fn rules_list(&self) -> Result<Vec<RuleDto>, AppError> {
        Ok(self
            .activities
            .list_rules()?
            .into_iter()
            .map(Into::into)
            .collect())
    }

    /// Validates a title pattern before saving it (R9.4); returns the persisted id.
    pub fn rules_upsert(&self, rule: RuleInputDto) -> Result<i64, AppError> {
        Ok(self.commands.save_rule(&rule.into())?)
    }

    pub fn rules_delete(&self, id: i64) -> Result<(), AppError> {
        Ok(self.commands.delete_rule(id)?)
    }

    pub fn presets_list(&self) -> Result<Vec<PresetDto>, AppError> {
        Ok(self.presets.packs().iter().map(Into::into).collect())
    }

    /// Creates the pack's activities and rules for apps already in the history; idempotent.
    pub fn presets_apply(&self, key: &str) -> Result<ApplyPresetResultDto, AppError> {
        Ok(self.presets.apply(key)?.into())
    }

    pub fn suggestions_list(&self) -> Result<Vec<SuggestionDto>, AppError> {
        Ok(self
            .presets
            .suggestions()?
            .into_iter()
            .map(Into::into)
            .collect())
    }

    /// Accepting files the app under the suggested activity with an app rule; history is
    /// classified at read time, so past segments follow it.
    pub fn suggestions_accept(&self, app_id: &str) -> Result<(), AppError> {
        Ok(self.presets.accept(app_id)?)
    }

    pub fn suggestions_dismiss(&self, app_id: &str) -> Result<(), AppError> {
        Ok(self.presets.dismiss(app_id)?)
    }

    pub fn privacy_list(&self) -> Result<PrivacyRulesDto, AppError> {
        Ok(self.commands.privacy_policy()?.into())
    }

    /// Applies to future snapshots only (R10.5): the engine reloads its policy.
    pub fn privacy_set(&self, app_id: &str, mode: Option<PrivacyModeDto>) -> Result<(), AppError> {
        self.commands
            .set_privacy_mode(app_id, mode.map(Into::into))?;
        self.engine.request(Command::ReloadPrivacy)?;
        Ok(())
    }

    pub fn settings_get(&self) -> Result<SettingsDto, AppError> {
        Ok(self.commands.get_settings()?.into())
    }

    /// Persists the patch, then applies what lives outside the database: `store_titles`
    /// (engine policy), the idle threshold (sampler), autostart, the global shortcut and the
    /// tray text.
    ///
    /// A failing side effect never undoes the saved settings (R6.3: the rest is kept); the
    /// first failure is returned after every side effect was attempted.
    pub fn settings_update(&self, patch: SettingsPatchDto) -> Result<SettingsDto, AppError> {
        let titles_changed = patch.store_titles.is_some();
        let autostart_changed = patch.autostart.is_some();
        let shortcut_changed = patch.shortcut.is_some();
        let tray_changed = patch.tray_display.is_some();
        let week_changed = patch.week_start.is_some();
        let settings = self.commands.update_settings(&patch.into())?;
        if titles_changed {
            self.engine.request(Command::ReloadPrivacy)?;
        }
        self.idle_threshold.set(settings.idle_threshold_secs);
        self.idle_policy.set(
            settings.idle_prompt_timeout_secs,
            settings.idle_auto_discard_below_secs,
        );

        let mut first_error = None;
        if let Some(applier) = self.applier() {
            if autostart_changed && let Err(e) = applier.set_autostart(settings.autostart) {
                first_error.get_or_insert(e);
            }
            if shortcut_changed && let Err(e) = applier.set_shortcut(&settings.shortcut) {
                first_error.get_or_insert(e);
            }
            if tray_changed || week_changed {
                applier.refresh_tray_text();
            }
            if week_changed {
                applier.refresh_goals();
            }
        }
        match first_error {
            Some(error) => Err(error),
            None => Ok(settings.into()),
        }
    }

    pub fn permission_status(&self) -> PermissionStateDto {
        self.permission.accessibility().into()
    }

    pub fn permission_request(&self) {
        self.permission.request();
    }

    pub fn permission_open_settings(&self) {
        self.permission.open_settings();
    }

    pub fn prepare_delete(&self, op: DeleteOpDto) -> Result<String, AppError> {
        Ok(self.commands.prepare_delete(op.into(), self.now())?.0)
    }

    pub fn delete_range(&self, range: RangeDto, token: String) -> Result<u32, AppError> {
        let removed = self
            .commands
            .delete_range(range.into(), &ConfirmToken(token), self.now())?;
        Ok(saturating_u32(removed))
    }

    pub fn purge_older_than(&self, days: u32, token: String) -> Result<u32, AppError> {
        let removed = self
            .commands
            .purge_older_than(days, &ConfirmToken(token), self.now())?;
        Ok(saturating_u32(removed))
    }

    /// Stops tracking first (the open segment would otherwise be deleted underneath the
    /// engine), then deletes everything. Configuration stays.
    pub fn delete_all(&self, token: String) -> Result<(), AppError> {
        self.engine.request(Command::Stop)?;
        Ok(self.commands.delete_all(&ConfirmToken(token), self.now())?)
    }

    fn now(&self) -> domain::UtcMs {
        use application::ports::Clock;
        self.clock.now()
    }
}

fn saturating_u32(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use application::fakes::{
        FakePermission, FakePower, FakeWindow, RecordingNotifier, RecordingSink,
    };
    use application::ports::{DomainEvent, TrackingKind};
    use domain::{FocusSnapshot, PermissionState};

    use super::*;
    use crate::composition::{Providers, compose};
    use crate::ipc::dto::{
        GoalKindDto, GoalScopeDto, GoalStateDto, PeriodDto, RetentionPatchDto, RuleSpecDto,
        TrackingStateDto, TrayDisplayDto,
    };

    struct Rig {
        state: AppState,
        window: FakeWindow,
        sink: RecordingSink,
        permission: FakePermission,
        _dir: tempfile::TempDir,
    }

    fn rig() -> Rig {
        let dir = tempfile::tempdir().unwrap();
        let window = FakeWindow::default();
        let sink = RecordingSink::default();
        let permission = FakePermission::new(PermissionState::Granted);
        let state = compose(
            &dir.path().join("timetrack.db"),
            Box::new(sink.clone()),
            AppState::default_shortcut(),
            Providers {
                window: Box::new(window.clone()),
                power: Box::new(FakePower::default()),
                permission: Arc::new(permission.clone()),
                notifier: Box::new(RecordingNotifier::default()),
                idle_threshold: adapters_common::idle::IdleThreshold::default(),
                sampler: None,
            },
        )
        .unwrap();
        Rig {
            state,
            window,
            sink,
            permission,
            _dir: dir,
        }
    }

    fn safari() -> FocusSnapshot {
        FocusSnapshot {
            app_id: "com.apple.Safari".into(),
            app_name: "Safari".into(),
            pid: 7,
            window_title: Some("Docs".into()),
        }
    }

    fn around_now(state: &AppState) -> RangeDto {
        let now = state.now().0;
        RangeDto {
            from: now - 3_600_000,
            to: now + 3_600_000,
        }
    }

    #[test]
    fn tracking_commands_walk_the_state_machine() {
        let rig = rig();
        rig.window.set(Some(safari()));
        assert_eq!(
            rig.state.get_status().unwrap().state,
            TrackingStateDto::Stopped
        );

        let started = rig.state.start().unwrap();
        assert_eq!(started.state, TrackingStateDto::Running);
        assert_eq!(started.current.unwrap().app_id, "com.apple.Safari");
        assert_eq!(rig.state.pause().unwrap().state, TrackingStateDto::Paused);
        assert_eq!(rig.state.resume().unwrap().state, TrackingStateDto::Running);
        assert_eq!(rig.state.stop().unwrap().state, TrackingStateDto::Stopped);
        rig.state.shutdown();
    }

    #[test]
    fn engine_events_reach_the_sink_including_status_changes() {
        let rig = rig();
        rig.window.set(Some(safari()));
        rig.state.start().unwrap();
        let events = rig.sink.events();
        assert!(events.iter().any(|e| matches!(
            e,
            DomainEvent::TrackingStatusChanged(s) if s.kind == TrackingKind::Running
        )));
        rig.state.shutdown();
    }

    #[test]
    fn tracked_time_shows_up_in_timeline_and_report() {
        let rig = rig();
        rig.window.set(Some(safari()));
        rig.state.start().unwrap();
        // An open segment counts up to "now"; a zero-length span is not reported.
        std::thread::sleep(std::time::Duration::from_millis(5));
        let range = around_now(&rig.state);

        let timeline = rig.state.get_timeline(range).unwrap();
        assert_eq!(timeline.len(), 1);
        assert_eq!(timeline[0].app_id.as_deref(), Some("com.apple.Safari"));
        assert!(timeline[0].open);

        let report = rig.state.get_report(range, vec![range]).unwrap();
        assert_eq!(report.by_app[0].app_name, "Safari");
        assert_eq!(report.by_bucket.len(), 1);
        rig.state.shutdown();
    }

    #[test]
    fn the_dashboard_summarizes_tracked_time_in_one_call() {
        let rig = rig();
        rig.window.set(Some(safari()));
        rig.state.start().unwrap();
        // The open segment counts up to "now".
        std::thread::sleep(std::time::Duration::from_millis(5));
        let range = around_now(&rig.state);
        let before = RangeDto {
            from: range.from - 7_200_000,
            to: range.from,
        };

        let dashboard = rig
            .state
            .get_dashboard(range, vec![range], Some(before))
            .unwrap();
        assert!(dashboard.total_ms > 0);
        assert_eq!(dashboard.by_app[0].app_name, "Safari");
        assert_eq!(dashboard.buckets.len(), 1);
        assert_eq!(dashboard.buckets[0].total_ms, dashboard.total_ms);
        assert_eq!(dashboard.heatmap.len(), 7 * 24);
        assert_eq!(dashboard.heatmap.iter().sum::<i64>(), dashboard.total_ms);
        // Nothing before the range: no comparison, and no productive/distracting signal.
        assert_eq!(dashboard.trend, crate::ipc::dto::TrendDto::NoComparison);
        assert_eq!(
            dashboard.focus_ratio,
            crate::ipc::dto::FocusRatioDto::NoSignal
        );
        rig.state.shutdown();
    }

    #[test]
    fn inverted_range_is_a_validation_error() {
        let rig = rig();
        let err = rig
            .state
            .get_timeline(RangeDto { from: 10, to: 5 })
            .unwrap_err();
        assert!(matches!(err, AppError::Invalid { .. }), "{err:?}");
        rig.state.shutdown();
    }

    #[test]
    fn invalid_title_pattern_is_rejected_before_saving() {
        let rig = rig();
        let err = rig
            .state
            .rules_upsert(RuleInputDto {
                id: 0,
                activity_id: 1,
                spec: RuleSpecDto::TitlePattern {
                    pattern: "(".into(),
                    app_id: None,
                },
                priority: 0,
            })
            .unwrap_err();
        assert!(matches!(err, AppError::InvalidPattern { .. }), "{err:?}");
        assert!(rig.state.rules_list().unwrap().is_empty());
        rig.state.shutdown();
    }

    #[test]
    fn accepting_a_suggestion_reclassifies_history_and_dismissals_stick() {
        let rig = rig();
        assert!(rig.state.suggestions_list().unwrap().is_empty());
        rig.window.set(Some(safari()));
        rig.state.start().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(50));
        rig.state.stop().unwrap();

        let range = around_now(&rig.state);
        let names = |state: &AppState| -> Vec<String> {
            state
                .get_report(range, vec![])
                .unwrap()
                .by_activity
                .into_iter()
                .map(|a| a.name)
                .collect()
        };
        assert_eq!(names(&rig.state), ["Unassigned"]);

        let suggestions = rig.state.suggestions_list().unwrap();
        assert_eq!(suggestions.len(), 1);
        assert_eq!(suggestions[0].activity_name, "Browsing");
        assert!(
            rig.state
                .activities_list()
                .unwrap()
                .iter()
                .all(|a| a.preset_key.is_none())
        );

        rig.state.suggestions_accept("com.apple.Safari").unwrap();
        assert_eq!(
            names(&rig.state),
            ["Browsing"],
            "past time follows the new rule"
        );
        assert!(rig.state.suggestions_list().unwrap().is_empty());
        let browsing = rig
            .state
            .activities_list()
            .unwrap()
            .into_iter()
            .find(|a| a.name == "Browsing")
            .unwrap();
        assert_eq!(browsing.preset_key.as_deref(), Some("general.browsing"));
        rig.state.shutdown();
    }

    #[test]
    fn presets_apply_is_opt_in_and_idempotent() {
        let rig = rig();
        assert!(!rig.state.presets_list().unwrap().is_empty());
        assert_eq!(
            rig.state.activities_list().unwrap().len(),
            1,
            "only the system activity"
        );
        rig.window.set(Some(safari()));
        rig.state.start().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        rig.state.stop().unwrap();

        let first = rig.state.presets_apply("general").unwrap();
        assert_eq!((first.activities_created, first.rules_created), (4, 1));
        let second = rig.state.presets_apply("general").unwrap();
        assert_eq!((second.activities_created, second.rules_created), (0, 0));
        assert!(rig.state.presets_apply("nope").is_err());

        rig.window.set(Some(safari()));
        rig.state.suggestions_dismiss("anything").unwrap();
        rig.state.shutdown();
    }

    #[test]
    fn dismissing_hides_the_suggestion_without_a_rule() {
        let rig = rig();
        rig.window.set(Some(safari()));
        rig.state.start().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        rig.state.stop().unwrap();
        assert_eq!(rig.state.suggestions_list().unwrap().len(), 1);
        rig.state.suggestions_dismiss("com.apple.Safari").unwrap();
        assert!(rig.state.suggestions_list().unwrap().is_empty());
        assert!(rig.state.rules_list().unwrap().is_empty());
        rig.state.shutdown();
    }

    #[test]
    fn activities_and_rules_round_trip() {
        let rig = rig();
        let work = rig
            .state
            .activities_create("Work", "#3366ff", ProductivityDto::Productive)
            .unwrap();
        let listed = rig.state.activities_list().unwrap();
        assert!(listed.iter().any(|c| c.id == work.id && c.name == "Work"));
        assert_eq!(work.productivity, ProductivityDto::Productive);

        let id = rig
            .state
            .rules_upsert(RuleInputDto {
                id: 0,
                activity_id: work.id,
                spec: RuleSpecDto::App {
                    app_id: "com.apple.Xcode".into(),
                },
                priority: 1,
            })
            .unwrap();
        assert_eq!(rig.state.rules_list().unwrap()[0].id, id);
        rig.state.rules_delete(id).unwrap();
        assert!(rig.state.rules_list().unwrap().is_empty());
        rig.state.shutdown();
    }

    #[test]
    fn deletion_needs_a_matching_confirmation_token() {
        let rig = rig();
        let range = around_now(&rig.state);
        assert_eq!(
            rig.state.delete_range(range, "forged".into()).unwrap_err(),
            AppError::ConfirmationRequired
        );
        let token = rig
            .state
            .prepare_delete(DeleteOpDto::Range { range })
            .unwrap();
        assert_eq!(rig.state.delete_range(range, token).unwrap(), 0);
        rig.state.shutdown();
    }

    #[test]
    fn delete_all_stops_tracking_first() {
        let rig = rig();
        rig.window.set(Some(safari()));
        rig.state.start().unwrap();
        let token = rig.state.prepare_delete(DeleteOpDto::All).unwrap();
        rig.state.delete_all(token).unwrap();
        assert_eq!(
            rig.state.get_status().unwrap().state,
            TrackingStateDto::Stopped
        );
        assert!(
            rig.state
                .get_timeline(around_now(&rig.state))
                .unwrap()
                .is_empty()
        );
        rig.state.shutdown();
    }

    #[test]
    fn settings_update_returns_the_merged_settings() {
        let rig = rig();
        let updated = rig
            .state
            .settings_update(SettingsPatchDto {
                store_titles: Some(false),
                retention: Some(RetentionPatchDto::Days { days: 30 }),
                ..Default::default()
            })
            .unwrap();
        assert!(!updated.store_titles);
        assert_eq!(updated.retention_days, Some(30));
        assert_eq!(updated.idle_threshold_secs, 300);
        assert_eq!(rig.state.settings_get().unwrap(), updated);
        rig.state.shutdown();
    }

    #[derive(Default)]
    struct RecordingApplier {
        calls: std::sync::Mutex<Vec<String>>,
        taken: bool,
    }

    impl crate::composition::SettingsApplier for RecordingApplier {
        fn set_autostart(&self, enabled: bool) -> Result<(), AppError> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("autostart:{enabled}"));
            Ok(())
        }
        fn set_shortcut(&self, shortcut: &str) -> Result<(), AppError> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("shortcut:{shortcut}"));
            if self.taken {
                return Err(AppError::ShortcutUnavailable {
                    shortcut: shortcut.into(),
                    reason: "in use".into(),
                });
            }
            Ok(())
        }
        fn refresh_tray_text(&self) {
            self.calls.lock().unwrap().push("tray".into());
        }
    }

    #[test]
    fn settings_update_applies_threshold_autostart_and_shortcut() {
        let rig = rig();
        let applier = Arc::new(RecordingApplier::default());
        rig.state.set_applier(applier.clone());
        rig.state
            .settings_update(SettingsPatchDto {
                idle_threshold_secs: Some(120),
                autostart: Some(true),
                shortcut: Some("⌃⌥⌘P".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(rig.state.idle_threshold.get(), 120);
        rig.state
            .settings_update(SettingsPatchDto {
                idle_prompt_timeout_secs: Some(45),
                idle_auto_discard_below_secs: Some(0),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(rig.state.idle_policy.prompt_timeout_secs(), 45);
        assert_eq!(rig.state.idle_policy.auto_discard_below_secs(), 0);
        assert_eq!(
            *applier.calls.lock().unwrap(),
            vec!["autostart:true".to_string(), "shortcut:⌃⌥⌘P".to_string()]
        );
        // Untouched fields are not re-applied.
        rig.state
            .settings_update(SettingsPatchDto {
                theme: Some("dark".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(applier.calls.lock().unwrap().len(), 2);
        rig.state.shutdown();
    }

    #[test]
    fn tray_display_is_persisted_and_refreshes_the_tray_text() {
        let rig = rig();
        let applier = Arc::new(RecordingApplier::default());
        rig.state.set_applier(applier.clone());
        assert_eq!(
            rig.state.settings_get().unwrap().tray_display,
            TrayDisplayDto::TodayTotal
        );
        let updated = rig
            .state
            .settings_update(SettingsPatchDto {
                tray_display: Some(TrayDisplayDto::CurrentApp),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(updated.tray_display, TrayDisplayDto::CurrentApp);
        assert_eq!(
            rig.state.settings_get().unwrap().tray_display,
            TrayDisplayDto::CurrentApp
        );
        assert_eq!(*applier.calls.lock().unwrap(), vec!["tray".to_string()]);
        rig.state.shutdown();
    }

    #[test]
    fn a_taken_shortcut_reports_the_error_but_keeps_the_other_settings() {
        let rig = rig();
        rig.state.set_applier(Arc::new(RecordingApplier {
            taken: true,
            ..Default::default()
        }));
        let err = rig
            .state
            .settings_update(SettingsPatchDto {
                theme: Some("dark".into()),
                shortcut: Some("⌃⌥⌘P".into()),
                ..Default::default()
            })
            .unwrap_err();
        assert!(matches!(err, AppError::ShortcutUnavailable { .. }));
        let saved = rig.state.settings_get().unwrap();
        assert_eq!(saved.theme, "dark");
        assert_eq!(saved.shortcut, "⌃⌥⌘P");
        rig.state.shutdown();
    }

    #[test]
    fn titles_switch_applies_to_the_next_snapshot() {
        let rig = rig();
        rig.window.set(Some(safari()));
        rig.state
            .settings_update(SettingsPatchDto {
                store_titles: Some(false),
                ..Default::default()
            })
            .unwrap();
        let status = rig.state.start().unwrap();
        assert_eq!(status.current.unwrap().window_title, None);
        rig.state.shutdown();
    }

    #[test]
    fn privacy_rules_are_listed_and_removable() {
        let rig = rig();
        rig.state
            .privacy_set("com.1password", Some(PrivacyModeDto::Exclude))
            .unwrap();
        assert_eq!(
            rig.state.privacy_list().unwrap().excluded_apps,
            ["com.1password"]
        );
        rig.state.privacy_set("com.1password", None).unwrap();
        assert!(rig.state.privacy_list().unwrap().excluded_apps.is_empty());
        rig.state.shutdown();
    }

    #[test]
    fn a_degraded_status_carries_the_platform_reason() {
        use application::ports::{DegradedReason, PermissionProvider, SystemSignal};

        use crate::ipc::dto::DegradedReasonDto;

        struct WaylandSession;
        impl PermissionProvider for WaylandSession {
            fn accessibility(&self) -> PermissionState {
                PermissionState::Denied
            }
            fn request(&self) {}
            fn open_settings(&self) {}
            fn degraded_reason(&self) -> DegradedReason {
                DegradedReason::WaylandSession
            }
        }

        let dir = tempfile::tempdir().unwrap();
        let state = compose(
            &dir.path().join("timetrack.db"),
            Box::new(RecordingSink::default()),
            AppState::default_shortcut(),
            Providers {
                permission: Arc::new(WaylandSession),
                ..Providers::placeholders()
            },
        )
        .unwrap();
        assert_eq!(state.get_status().unwrap().degraded_reason, None);

        state
            .engine
            .signal(SystemSignal::PermissionChanged(PermissionState::Denied));
        // Signals and commands travel on separate channels: wait for the signal to land.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let status = loop {
            let status = state.get_status().unwrap();
            if status.degraded || std::time::Instant::now() > deadline {
                break status;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        };
        assert!(status.degraded);
        assert_eq!(
            status.degraded_reason,
            Some(DegradedReasonDto::WaylandSession)
        );
        state.shutdown();
    }

    #[test]
    fn permission_commands_delegate_to_the_provider() {
        use std::sync::atomic::Ordering;
        let rig = rig();
        assert_eq!(rig.state.permission_status(), PermissionStateDto::Granted);
        rig.permission.set(PermissionState::Denied);
        assert_eq!(rig.state.permission_status(), PermissionStateDto::Denied);
        rig.state.permission_request();
        rig.state.permission_open_settings();
        assert_eq!(rig.permission.requests.load(Ordering::SeqCst), 1);
        assert_eq!(rig.permission.settings_opened.load(Ordering::SeqCst), 1);
        rig.state.shutdown();
    }

    #[test]
    fn unknown_gap_is_not_found_and_shutdown_is_idempotent() {
        let rig = rig();
        assert!(rig.state.list_pending_idle_gaps().unwrap().is_empty());
        assert_eq!(
            rig.state
                .resolve_idle_gap(999, IdleResolutionDto::Discard)
                .unwrap_err(),
            AppError::NotFound
        );
        rig.state.shutdown();
        rig.state.shutdown();
        assert!(matches!(
            rig.state.get_status().unwrap_err(),
            AppError::Internal { .. }
        ));
    }

    fn data_dir(rig: &Rig) -> std::path::PathBuf {
        rig._dir.path().to_path_buf()
    }

    #[test]
    fn a_json_export_holds_the_range_and_is_written_atomically() {
        let rig = rig();
        rig.window.set(Some(safari()));
        rig.state.start().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let path = data_dir(&rig).join("out/export.json");

        rig.state
            .export_json_to(&path, around_now(&rig.state))
            .unwrap();

        let doc = application::backup::Document::parse(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(doc.kind, application::backup::Kind::Export);
        assert_eq!(doc.data.segments.len(), 1);
        assert_eq!(doc.data.segments[0].app_name.as_deref(), Some("Safari"));
        assert!(
            doc.data.segments[0].ended_at.is_some(),
            "open segment exported closed"
        );
        assert!(doc.timezone.starts_with("UTC"));
        assert!(
            rig.state
                .export_json_to(&path, RangeDto { from: 10, to: 5 })
                .is_err()
        );
        rig.state.shutdown();
    }

    #[test]
    fn the_scheduled_backup_runs_once_per_day_and_reports_the_outcome() {
        let rig = rig();
        let mut events = Vec::new();
        let collect = std::cell::RefCell::new(&mut events);
        crate::backup_worker::cycle(&rig.state, &|e| collect.borrow_mut().push(e));
        crate::backup_worker::cycle(&rig.state, &|e| collect.borrow_mut().push(e));

        assert_eq!(events.len(), 1, "the second check finds today's backup");
        assert!(events[0].ok);
        let status = rig.state.backup_status().unwrap();
        assert_eq!(status.stored, 1);
        assert!(status.last_backup_at.is_some());
        assert!(status.dir.ends_with("backups"));
        assert!(std::path::Path::new(&events[0].message).exists());
        rig.state.shutdown();
    }

    #[test]
    fn an_unusable_backup_folder_is_announced_once() {
        let rig = rig();
        // A file where the folder should be: nothing can be created inside it.
        let blocker = data_dir(&rig).join("blocker");
        std::fs::write(&blocker, b"x").unwrap();
        rig.state
            .backup_set_dir(Some(&blocker.join("sub").display().to_string()))
            .unwrap();

        let mut events = Vec::new();
        let collect = std::cell::RefCell::new(&mut events);
        for _ in 0..3 {
            crate::backup_worker::cycle(&rig.state, &|e| collect.borrow_mut().push(e));
        }
        assert_eq!(events.len(), 1);
        assert!(!events[0].ok);
        let status = rig.state.backup_status().unwrap();
        assert!(status.last_error.is_some());
        assert!(status.last_backup_at.is_none());
        rig.state.shutdown();
    }

    #[test]
    fn restore_replaces_the_data_after_a_previewed_confirmation() {
        let rig = rig();
        rig.window.set(Some(safari()));
        rig.state
            .activities_create("Work", "#111111", ProductivityDto::Productive)
            .unwrap();
        let report = rig.state.backup_now().unwrap();
        let after_backup = rig
            .state
            .activities_create("Later", "#222222", ProductivityDto::Neutral)
            .unwrap();
        rig.state.start().unwrap();

        let preview = rig
            .state
            .restore_prepare_file(std::path::Path::new(&report.path))
            .unwrap();
        assert_eq!(preview.kind, crate::ipc::dto::DocumentKindDto::Backup);
        assert_eq!(preview.activities, 2, "Unassigned and Work");
        assert_eq!(
            rig.state.activities_list().unwrap().len(),
            3,
            "preview changes nothing"
        );

        // A wrong token does nothing; the right one restores.
        assert_eq!(
            rig.state.restore_apply("nope".into()).unwrap_err(),
            AppError::ConfirmationRequired
        );
        let result = rig.state.restore_apply(preview.token).unwrap();

        let names: Vec<String> = rig
            .state
            .activities_list()
            .unwrap()
            .into_iter()
            .map(|a| a.name)
            .collect();
        assert_eq!(names, ["Unassigned", "Work"]);
        assert!(!names.contains(&after_backup.name));
        assert!(std::path::Path::new(&result.safety_copy).exists());
        assert_eq!(
            rig.state.get_status().unwrap().state,
            TrackingStateDto::Running,
            "tracking picks up again"
        );
        rig.state.shutdown();
    }

    #[test]
    fn restoring_a_bad_file_leaves_everything_untouched() {
        let rig = rig();
        let bad = data_dir(&rig).join("bad.json.gz");
        std::fs::write(&bad, b"definitely not a backup").unwrap();
        assert!(matches!(
            rig.state.restore_prepare_file(&bad).unwrap_err(),
            AppError::Invalid { .. }
        ));
        assert_eq!(rig.state.activities_list().unwrap().len(), 1);
        rig.state.shutdown();
    }

    #[test]
    fn retention_impact_reports_without_deleting() {
        let rig = rig();
        let impact = rig.state.retention_impact(30).unwrap();
        assert_eq!(impact.segments, 0);
        assert_eq!(impact.streak_days_cut, None);
        assert!(rig.state.retention_impact(0).is_err());
        rig.state.shutdown();
    }

    fn minimum_goal(scope: GoalScopeDto, target_ms: i64) -> GoalDto {
        GoalDto {
            id: 0,
            label: "Deep work".into(),
            scope,
            period: PeriodDto::Daily,
            kind: GoalKindDto::Minimum,
            target_ms,
            active_days: 127,
            archived: false,
        }
    }

    #[test]
    fn goals_are_created_listed_reported_and_deleted() {
        let rig = rig();
        assert!(rig.state.goals_status().unwrap().is_empty());
        let saved = rig
            .state
            .goals_upsert(minimum_goal(GoalScopeDto::Total, 3_600_000))
            .unwrap();
        assert!(saved.id > 0);
        assert_eq!(rig.state.goals_list().unwrap(), vec![saved.clone()]);

        let status = rig.state.goals_status().unwrap();
        assert_eq!(status.len(), 1);
        assert_eq!(status[0].state, GoalStateDto::Pending);
        assert_eq!(status[0].target_ms, 3_600_000);

        // The Overview carries the same figures.
        let dashboard = rig
            .state
            .get_dashboard(around_now(&rig.state), Vec::new(), None)
            .unwrap();
        assert_eq!(dashboard.goals, status);

        // Invalid goals are rejected before storage; an unknown activity too.
        assert!(matches!(
            rig.state
                .goals_upsert(minimum_goal(GoalScopeDto::Total, 0))
                .unwrap_err(),
            AppError::Invalid { .. }
        ));
        assert!(matches!(
            rig.state
                .goals_upsert(minimum_goal(
                    GoalScopeDto::Activity { activity_id: 99 },
                    1_000
                ))
                .unwrap_err(),
            AppError::Invalid { .. }
        ));

        rig.state.goals_delete(saved.id).unwrap();
        assert!(rig.state.goals_list().unwrap().is_empty());
        rig.state.shutdown();
    }

    #[test]
    fn deleting_an_activity_removes_the_goals_that_target_it() {
        let rig = rig();
        let work = rig
            .state
            .activities_create("Work", "#111111", ProductivityDto::Productive)
            .unwrap();
        rig.state
            .goals_upsert(minimum_goal(
                GoalScopeDto::Activity {
                    activity_id: work.id,
                },
                3_600_000,
            ))
            .unwrap();
        rig.state
            .goals_upsert(minimum_goal(GoalScopeDto::Total, 1_000))
            .unwrap();
        rig.state.activities_delete(work.id).unwrap();
        let left = rig.state.goals_list().unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].scope, GoalScopeDto::Total);
        rig.state.shutdown();
    }

    #[test]
    fn the_week_start_is_a_setting_and_changes_weekly_periods() {
        let rig = rig();
        assert_eq!(rig.state.settings_get().unwrap().week_start, 0);
        let mut weekly = minimum_goal(GoalScopeDto::Total, 3_600_000);
        weekly.period = PeriodDto::Weekly;
        rig.state.goals_upsert(weekly).unwrap();
        let monday_first = rig.state.goals_status().unwrap().remove(0).period;

        let patch = SettingsPatchDto {
            week_start: Some(6),
            ..SettingsPatchDto::default()
        };
        assert_eq!(rig.state.settings_update(patch).unwrap().week_start, 6);
        let sunday_first = rig.state.goals_status().unwrap().remove(0).period;
        // Both weeks last seven days (DST aside) but do not start on the same day.
        assert_ne!(monday_first.from, sunday_first.from);
        assert!(
            rig.state
                .settings_update(SettingsPatchDto {
                    week_start: Some(9),
                    ..SettingsPatchDto::default()
                })
                .is_err()
        );
        rig.state.shutdown();
    }

    #[test]
    fn goals_survive_a_backup_and_restore() {
        let rig = rig();
        rig.state
            .goals_upsert(minimum_goal(GoalScopeDto::Total, 3_600_000))
            .unwrap();
        let report = rig.state.backup_now().unwrap();
        let first = rig.state.goals_list().unwrap().remove(0);
        rig.state.goals_delete(first.id).unwrap();
        rig.state
            .goals_upsert(minimum_goal(GoalScopeDto::Total, 7_200_000))
            .unwrap();

        let preview = rig
            .state
            .restore_prepare_file(std::path::Path::new(&report.path))
            .unwrap();
        rig.state.restore_apply(preview.token).unwrap();
        let restored = rig.state.goals_list().unwrap();
        assert_eq!(restored, vec![first]);
        rig.state.shutdown();
    }
}
