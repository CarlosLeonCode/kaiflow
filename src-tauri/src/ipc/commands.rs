//! `#[tauri::command]` wrappers. Each one runs its use case from `api.rs` on the blocking
//! pool so SQLite and engine round trips never stall the main thread, and maps failures to
//! `AppError`. Plugins (dialog) are only ever called from here, never from a window (R6.5).

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_specta::Event;

use super::ai_dto::{
    AiProviderDto, AiReviewDto, AiSettingsDto, AiSettingsPatchDto, ReviewPreviewDto,
    WeeklyReviewDto,
};
use super::dto::{
    ActivityDto, ApplyPresetResultDto, BackupReportDto, BackupStatusDto, DashboardDto, DeleteOpDto,
    FocusSessionDto, FocusStartDto, FocusStatusDto, GoalDto, GoalStatusDto, IdleGapDto,
    IdleResolutionDto, PermissionStateDto, PresetDto, PrivacyModeDto, PrivacyRulesDto,
    ProductivityDto, RangeDto, ReportDto, RestorePreviewDto, RestoreResultDto, RetentionImpactDto,
    RuleDto, RuleInputDto, RulePreviewDto, RuleSpecDto, SettingsDto, SettingsPatchDto,
    SuggestionDto, TimelineItemDto, TrackingStatusDto, UpdateInfoDto,
};
use super::events::{DataChanged, DataKindDto, FocusChanged};
use crate::composition::AppState;
use crate::error::AppError;

type Shared<'a> = State<'a, Arc<AppState>>;

/// Runs a use case on the blocking pool.
async fn run<T, F>(state: Shared<'_>, job: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce(&AppState) -> Result<T, AppError> + Send + 'static,
{
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || job(&state))
        .await
        .map_err(|e| AppError::Internal {
            message: e.to_string(),
        })?
}

/// Tells every window that stored segments changed (deletions bypass the engine).
fn announce_data_changed(app: &AppHandle) {
    let _ = DataChanged {
        kind: DataKindDto::Segments,
    }
    .emit(app);
}

/// Tells every window that goals changed (the popover keeps its own copy of their progress).
fn announce_goals_changed(app: &AppHandle) {
    let _ = DataChanged {
        kind: DataKindDto::Goals,
    }
    .emit(app);
}

/// Tells every window the focus session changed; they refetch `focus_status`.
fn announce_focus(app: &AppHandle, status: &FocusStatusDto) {
    let _ = FocusChanged {
        active: status.active.is_some(),
        drifting: status.active.as_ref().is_some_and(|a| a.alerting.is_some()),
    }
    .emit(app);
}

#[tauri::command]
#[specta::specta]
pub async fn get_status(state: Shared<'_>) -> Result<TrackingStatusDto, AppError> {
    run(state, AppState::get_status).await
}

#[tauri::command]
#[specta::specta]
pub async fn start(state: Shared<'_>) -> Result<TrackingStatusDto, AppError> {
    run(state, AppState::start).await
}

#[tauri::command]
#[specta::specta]
pub async fn pause(state: Shared<'_>) -> Result<TrackingStatusDto, AppError> {
    run(state, AppState::pause).await
}

#[tauri::command]
#[specta::specta]
pub async fn resume(state: Shared<'_>) -> Result<TrackingStatusDto, AppError> {
    run(state, AppState::resume).await
}

#[tauri::command]
#[specta::specta]
pub async fn stop(state: Shared<'_>) -> Result<TrackingStatusDto, AppError> {
    run(state, AppState::stop).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_report(
    state: Shared<'_>,
    range: RangeDto,
    buckets: Vec<RangeDto>,
) -> Result<ReportDto, AppError> {
    run(state, move |s| s.get_report(range, buckets)).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_dashboard(
    state: Shared<'_>,
    range: RangeDto,
    buckets: Vec<RangeDto>,
    previous: Option<RangeDto>,
) -> Result<DashboardDto, AppError> {
    run(state, move |s| s.get_dashboard(range, buckets, previous)).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_timeline(
    state: Shared<'_>,
    range: RangeDto,
) -> Result<Vec<TimelineItemDto>, AppError> {
    run(state, move |s| s.get_timeline(range)).await
}

#[tauri::command]
#[specta::specta]
pub async fn list_pending_idle_gaps(state: Shared<'_>) -> Result<Vec<IdleGapDto>, AppError> {
    run(state, AppState::list_pending_idle_gaps).await
}

#[tauri::command]
#[specta::specta]
pub async fn resolve_idle_gap(
    state: Shared<'_>,
    id: i64,
    resolution: IdleResolutionDto,
) -> Result<(), AppError> {
    run(state, move |s| s.resolve_idle_gap(id, resolution)).await
}

#[tauri::command]
#[specta::specta]
pub async fn activities_list(state: Shared<'_>) -> Result<Vec<ActivityDto>, AppError> {
    run(state, AppState::activities_list).await
}

#[tauri::command]
#[specta::specta]
pub async fn activities_create(
    state: Shared<'_>,
    name: String,
    color: String,
    productivity: ProductivityDto,
) -> Result<ActivityDto, AppError> {
    run(state, move |s| {
        s.activities_create(&name, &color, productivity)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn activities_update(state: Shared<'_>, activity: ActivityDto) -> Result<(), AppError> {
    run(state, move |s| s.activities_update(activity)).await
}

#[tauri::command]
#[specta::specta]
pub async fn activities_delete(state: Shared<'_>, id: i64) -> Result<(), AppError> {
    run(state, move |s| s.activities_delete(id)).await
}

#[tauri::command]
#[specta::specta]
pub async fn rules_list(state: Shared<'_>) -> Result<Vec<RuleDto>, AppError> {
    run(state, AppState::rules_list).await
}

/// Validates the title pattern first (R9.4): a bad regex is `AppError::InvalidPattern`.
#[tauri::command]
#[specta::specta]
pub async fn rules_upsert(state: Shared<'_>, rule: RuleInputDto) -> Result<i64, AppError> {
    run(state, move |s| s.rules_upsert(rule)).await
}

/// How much tracked time a rule would cover in `range`, before it is saved. Read-only.
#[tauri::command]
#[specta::specta]
pub async fn rules_preview(
    state: Shared<'_>,
    spec: RuleSpecDto,
    range: RangeDto,
) -> Result<RulePreviewDto, AppError> {
    run(state, move |s| s.rules_preview(spec, range)).await
}

#[tauri::command]
#[specta::specta]
pub async fn rules_delete(state: Shared<'_>, id: i64) -> Result<(), AppError> {
    run(state, move |s| s.rules_delete(id)).await
}

/// The preset catalog; read-only, nothing is created by listing it.
#[tauri::command]
#[specta::specta]
pub async fn presets_list(state: Shared<'_>) -> Result<Vec<PresetDto>, AppError> {
    run(state, AppState::presets_list).await
}

/// Creates the pack's activities and rules for apps already in the history (idempotent).
#[tauri::command]
#[specta::specta]
pub async fn presets_apply(
    state: Shared<'_>,
    key: String,
) -> Result<ApplyPresetResultDto, AppError> {
    run(state, move |s| s.presets_apply(&key)).await
}

#[tauri::command]
#[specta::specta]
pub async fn suggestions_list(state: Shared<'_>) -> Result<Vec<SuggestionDto>, AppError> {
    run(state, AppState::suggestions_list).await
}

/// Files the app under its suggested activity with an app rule (reclassifies history).
#[tauri::command]
#[specta::specta]
pub async fn suggestions_accept(state: Shared<'_>, app_id: String) -> Result<(), AppError> {
    run(state, move |s| s.suggestions_accept(&app_id)).await
}

#[tauri::command]
#[specta::specta]
pub async fn suggestions_dismiss(state: Shared<'_>, app_id: String) -> Result<(), AppError> {
    run(state, move |s| s.suggestions_dismiss(&app_id)).await
}

#[tauri::command]
#[specta::specta]
pub async fn privacy_list(state: Shared<'_>) -> Result<PrivacyRulesDto, AppError> {
    run(state, AppState::privacy_list).await
}

/// `mode: null` removes the app's rule.
#[tauri::command]
#[specta::specta]
pub async fn privacy_set(
    state: Shared<'_>,
    app_id: String,
    mode: Option<PrivacyModeDto>,
) -> Result<(), AppError> {
    run(state, move |s| s.privacy_set(&app_id, mode)).await
}

#[tauri::command]
#[specta::specta]
pub async fn settings_get(state: Shared<'_>) -> Result<SettingsDto, AppError> {
    run(state, AppState::settings_get).await
}

#[tauri::command]
#[specta::specta]
pub async fn settings_update(
    state: Shared<'_>,
    patch: SettingsPatchDto,
) -> Result<SettingsDto, AppError> {
    run(state, move |s| s.settings_update(patch)).await
}

#[tauri::command]
#[specta::specta]
pub async fn permission_status(state: Shared<'_>) -> Result<PermissionStateDto, AppError> {
    run(state, |s| Ok(s.permission_status())).await
}

#[tauri::command]
#[specta::specta]
pub async fn permission_request(state: Shared<'_>) -> Result<(), AppError> {
    run(state, |s| {
        s.permission_request();
        Ok(())
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn permission_open_settings(state: Shared<'_>) -> Result<(), AppError> {
    run(state, |s| {
        s.permission_open_settings();
        Ok(())
    })
    .await
}

/// Relaunches the app (Accessibility sometimes needs it after the grant). Closes the open
/// segment first because the relaunch does not run the normal exit path.
///
/// Inside a `.app` a brand new instance is started through LaunchServices (new pid, so the
/// AX client cache is rebuilt); Tauri's `restart` keeps the pid. The single-instance lock is
/// released first, otherwise the new instance would defer to this one and exit.
#[tauri::command]
#[specta::specta]
pub async fn app_restart(app: AppHandle, state: Shared<'_>) -> Result<(), AppError> {
    run(state, |s| {
        s.shutdown();
        Ok(())
    })
    .await?;
    // Every platform: Tauri's restart starts the new process before this one exits.
    tauri_plugin_single_instance::destroy(&app);
    #[cfg(target_os = "macos")]
    {
        match adapters_macos::permission::spawn_relaunch() {
            Ok(()) => {
                app.exit(0);
                return Ok(());
            }
            Err(reason) => {
                eprintln!("relaunch through LaunchServices failed ({reason}); restarting in place")
            }
        }
    }
    app.restart()
}

/// Opens and focuses the main window (the popover's "Open dashboard" action). The window
/// work is queued for the main thread and never waited for.
#[tauri::command]
#[specta::specta]
pub async fn open_main_window(app: AppHandle) -> Result<(), AppError> {
    let target = app.clone();
    app.run_on_main_thread(move || crate::windows::show_main(&target))
        .map_err(|e| AppError::Internal {
            message: e.to_string(),
        })
}

/// Hides the popover (Escape key). Same reason as `close_onboarding`: the popover window gets
/// no `core:window` permission (R6.5), so the backend does it.
#[tauri::command]
#[specta::specta]
pub async fn hide_popover(app: AppHandle) -> Result<(), AppError> {
    let target = app.clone();
    app.run_on_main_thread(move || crate::windows::hide_popover(&target))
        .map_err(|e| AppError::Internal {
            message: e.to_string(),
        })
}

/// Closes the onboarding window once the user finished (or dismissed) the guided steps. The
/// window never gets `core:window` permissions (R6.5), so the backend does it.
#[tauri::command]
#[specta::specta]
pub async fn close_onboarding(app: AppHandle) -> Result<(), AppError> {
    let target = app.clone();
    app.run_on_main_thread(move || crate::windows::close_onboarding(&target))
        .map_err(|e| AppError::Internal {
            message: e.to_string(),
        })
}

#[tauri::command]
#[specta::specta]
pub async fn prepare_delete(state: Shared<'_>, op: DeleteOpDto) -> Result<String, AppError> {
    run(state, move |s| s.prepare_delete(op)).await
}

#[tauri::command]
#[specta::specta]
pub async fn delete_range(
    app: AppHandle,
    state: Shared<'_>,
    range: RangeDto,
    confirm_token: String,
) -> Result<u32, AppError> {
    let removed = run(state, move |s| s.delete_range(range, confirm_token)).await?;
    announce_data_changed(&app);
    Ok(removed)
}

#[tauri::command]
#[specta::specta]
pub async fn purge_older_than(
    app: AppHandle,
    state: Shared<'_>,
    days: u32,
    confirm_token: String,
) -> Result<u32, AppError> {
    let removed = run(state, move |s| s.purge_older_than(days, confirm_token)).await?;
    announce_data_changed(&app);
    Ok(removed)
}

#[tauri::command]
#[specta::specta]
pub async fn delete_all(
    app: AppHandle,
    state: Shared<'_>,
    confirm_token: String,
) -> Result<(), AppError> {
    run(state, move |s| s.delete_all(confirm_token)).await?;
    announce_data_changed(&app);
    Ok(())
}

/// Asks where to save (native dialog, from Rust) and writes the JSON export there. Returns
/// the chosen path, or `null` when the user cancelled (nothing is written then).
#[tauri::command]
#[specta::specta]
pub async fn export_json(
    app: AppHandle,
    state: Shared<'_>,
    range: RangeDto,
) -> Result<Option<String>, AppError> {
    let chosen = blocking_dialog(&app, |app| {
        app.dialog()
            .file()
            .add_filter("JSON", &["json"])
            .set_file_name("time-track-export.json")
            .blocking_save_file()
    })
    .await?;
    let Some(path) = chosen else {
        return Ok(None);
    };
    run(state, move |s| {
        s.export_json_to(&path, range)?;
        Ok(Some(path.display().to_string()))
    })
    .await
}

/// Runs a native dialog on the blocking pool and turns its answer into a path; `None` when
/// the user cancelled.
async fn blocking_dialog<F>(app: &AppHandle, pick: F) -> Result<Option<PathBuf>, AppError>
where
    F: FnOnce(&AppHandle) -> Option<tauri_plugin_dialog::FilePath> + Send + 'static,
{
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        pick(&app)
            .map(|chosen| {
                chosen.into_path().map_err(|e| AppError::Internal {
                    message: e.to_string(),
                })
            })
            .transpose()
    })
    .await
    .map_err(|e| AppError::Internal {
        message: e.to_string(),
    })?
}

#[tauri::command]
#[specta::specta]
pub async fn backup_status(state: Shared<'_>) -> Result<BackupStatusDto, AppError> {
    run(state, AppState::backup_status).await
}

#[tauri::command]
#[specta::specta]
pub async fn backup_set_enabled(
    state: Shared<'_>,
    enabled: bool,
) -> Result<BackupStatusDto, AppError> {
    run(state, move |s| s.backup_set_enabled(enabled)).await
}

/// Lets the user pick the backup folder (native dialog, from Rust). Cancelling keeps the
/// current folder. Returns the resulting status either way.
#[tauri::command]
#[specta::specta]
pub async fn backup_choose_dir(
    app: AppHandle,
    state: Shared<'_>,
) -> Result<BackupStatusDto, AppError> {
    let chosen = blocking_dialog(&app, |app| app.dialog().file().blocking_pick_folder()).await?;
    run(state, move |s| match chosen {
        Some(dir) => s.backup_set_dir(Some(&dir.to_string_lossy())),
        None => s.backup_status(),
    })
    .await
}

/// Goes back to the default backup folder.
#[tauri::command]
#[specta::specta]
pub async fn backup_reset_dir(state: Shared<'_>) -> Result<BackupStatusDto, AppError> {
    run(state, |s| s.backup_set_dir(None)).await
}

#[tauri::command]
#[specta::specta]
pub async fn backup_now(state: Shared<'_>) -> Result<BackupReportDto, AppError> {
    run(state, AppState::backup_now).await
}

/// Step one of a restore: asks for a backup or export file (native dialog, from Rust),
/// validates it and returns a preview with a confirmation token. `null` when the user
/// cancelled. Nothing is modified.
#[tauri::command]
#[specta::specta]
pub async fn restore_prepare(
    app: AppHandle,
    state: Shared<'_>,
) -> Result<Option<RestorePreviewDto>, AppError> {
    let chosen = blocking_dialog(&app, |app| {
        app.dialog()
            .file()
            .add_filter("Time Track backup or export", &["gz", "json"])
            .blocking_pick_file()
    })
    .await?;
    let Some(path) = chosen else {
        return Ok(None);
    };
    run(state, move |s| s.restore_prepare_file(&path).map(Some)).await
}

/// Step two: with the token from `restore_prepare`, copies the database aside and replaces
/// every piece of data in one transaction.
#[tauri::command]
#[specta::specta]
pub async fn restore_apply(
    app: AppHandle,
    state: Shared<'_>,
    token: String,
) -> Result<RestoreResultDto, AppError> {
    let result = run(state, move |s| s.restore_apply(token)).await?;
    announce_data_changed(&app);
    Ok(result)
}

/// Dry run of "delete data older than N days", for the confirmation text.
#[tauri::command]
#[specta::specta]
pub async fn retention_impact(
    state: Shared<'_>,
    days: u32,
) -> Result<RetentionImpactDto, AppError> {
    run(state, move |s| s.retention_impact(days)).await
}

/// Asks the update server for a newer signed release. Returns it (and announces it with
/// `update-available`), or `null` when the app is current or updates are not configured.
#[tauri::command]
#[specta::specta]
pub async fn update_check(
    app: AppHandle,
    updates: State<'_, crate::updater::UpdaterState>,
) -> Result<Option<UpdateInfoDto>, AppError> {
    crate::updater::check_now(&app, updates.inner()).await
}

/// Downloads, verifies and installs the update found by the last check, then relaunches.
#[tauri::command]
#[specta::specta]
pub async fn update_install(
    app: AppHandle,
    state: Shared<'_>,
    updates: State<'_, crate::updater::UpdaterState>,
) -> Result<(), AppError> {
    crate::updater::install_pending(&app, state.inner(), updates.inner()).await
}

#[tauri::command]
#[specta::specta]
pub async fn goals_list(state: Shared<'_>) -> Result<Vec<GoalDto>, AppError> {
    run(state, AppState::goals_list).await
}

#[tauri::command]
#[specta::specta]
pub async fn goals_upsert(
    app: AppHandle,
    state: Shared<'_>,
    goal: GoalDto,
) -> Result<GoalDto, AppError> {
    let saved = run(state, move |s| s.goals_upsert(goal)).await?;
    announce_goals_changed(&app);
    Ok(saved)
}

#[tauri::command]
#[specta::specta]
pub async fn goals_delete(app: AppHandle, state: Shared<'_>, id: i64) -> Result<(), AppError> {
    run(state, move |s| s.goals_delete(id)).await?;
    announce_goals_changed(&app);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn goals_status(state: Shared<'_>) -> Result<Vec<GoalStatusDto>, AppError> {
    run(state, AppState::goals_status).await
}

#[tauri::command]
#[specta::specta]
pub async fn goal_events_mark_seen(
    app: AppHandle,
    state: Shared<'_>,
    goal_id: i64,
) -> Result<(), AppError> {
    run(state, move |s| s.goal_events_mark_seen(goal_id)).await?;
    announce_goals_changed(&app);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn focus_status(state: Shared<'_>) -> Result<FocusStatusDto, AppError> {
    run(state, AppState::focus_status).await
}

/// Fails with `focus_unavailable` while tracking is degraded.
#[tauri::command]
#[specta::specta]
pub async fn focus_start(
    app: AppHandle,
    state: Shared<'_>,
    start: FocusStartDto,
) -> Result<FocusStatusDto, AppError> {
    let status = run(state, move |s| s.focus_start(start)).await?;
    announce_focus(&app, &status);
    Ok(status)
}

/// Ends the session now ("End session"); its summary waits until dismissed.
#[tauri::command]
#[specta::specta]
pub async fn focus_stop(app: AppHandle, state: Shared<'_>) -> Result<FocusStatusDto, AppError> {
    let status = run(state, AppState::focus_stop).await?;
    announce_focus(&app, &status);
    Ok(status)
}

#[tauri::command]
#[specta::specta]
pub async fn focus_extend(
    app: AppHandle,
    state: Shared<'_>,
    minutes: u32,
) -> Result<FocusStatusDto, AppError> {
    let status = run(state, move |s| s.focus_extend(minutes)).await?;
    announce_focus(&app, &status);
    Ok(status)
}

/// "Back to it": acknowledges the drift alert and holds the next one back for `minutes`.
#[tauri::command]
#[specta::specta]
pub async fn focus_snooze(
    app: AppHandle,
    state: Shared<'_>,
    minutes: u32,
) -> Result<FocusStatusDto, AppError> {
    let status = run(state, move |s| s.focus_snooze(minutes)).await?;
    announce_focus(&app, &status);
    Ok(status)
}

/// "Allow this app" for the rest of the session.
#[tauri::command]
#[specta::specta]
pub async fn focus_allow_app(
    app: AppHandle,
    state: Shared<'_>,
    app_id: String,
) -> Result<FocusStatusDto, AppError> {
    let status = run(state, move |s| s.focus_allow_app(&app_id)).await?;
    announce_focus(&app, &status);
    Ok(status)
}

#[tauri::command]
#[specta::specta]
pub async fn focus_history(state: Shared<'_>) -> Result<Vec<FocusSessionDto>, AppError> {
    run(state, AppState::focus_history).await
}

/// The user closed the end summary of a finished session.
#[tauri::command]
#[specta::specta]
pub async fn focus_summary_dismiss(
    app: AppHandle,
    state: Shared<'_>,
    id: i64,
) -> Result<FocusStatusDto, AppError> {
    let status = run(state, move |s| s.focus_summary_dismiss(id)).await?;
    announce_focus(&app, &status);
    Ok(status)
}

// ---- weekly review and the optional AI analysis ----

/// Tells every window the review history changed.
fn announce_reviews_changed(app: &AppHandle) {
    let _ = DataChanged {
        kind: DataKindDto::Reviews,
    }
    .emit(app);
}

/// AI settings and the state of the key store. Never returns a key.
#[tauri::command]
#[specta::specta]
pub async fn ai_settings_get(state: Shared<'_>) -> Result<AiSettingsDto, AppError> {
    run(state, AppState::ai_settings).await
}

#[tauri::command]
#[specta::specta]
pub async fn ai_settings_update(
    state: Shared<'_>,
    patch: AiSettingsPatchDto,
) -> Result<AiSettingsDto, AppError> {
    run(state, move |s| s.ai_settings_update(patch)).await
}

/// The only way a key enters the app: it goes straight to the OS keychain and is never
/// returned. Refused (never stored anywhere else) when the OS has no secure store.
#[tauri::command]
#[specta::specta]
pub async fn ai_set_key(
    state: Shared<'_>,
    provider: AiProviderDto,
    key: String,
) -> Result<AiSettingsDto, AppError> {
    run(state, move |s| s.ai_set_key(provider, &key)).await
}

#[tauri::command]
#[specta::specta]
pub async fn ai_delete_key(
    state: Shared<'_>,
    provider: AiProviderDto,
) -> Result<AiSettingsDto, AppError> {
    run(state, move |s| s.ai_delete_key(provider)).await
}

/// Whether a key is saved (never the key itself).
#[tauri::command]
#[specta::specta]
pub async fn ai_has_key(state: Shared<'_>, provider: AiProviderDto) -> Result<bool, AppError> {
    run(state, move |s| s.ai_has_key(provider)).await
}

/// Checks the key and the connection of a provider that is switched on; returns how many
/// models it lists. `ai_not_enabled` (no traffic) before the opt-in.
#[tauri::command]
#[specta::specta]
pub async fn ai_test(state: Shared<'_>, provider: AiProviderDto) -> Result<u32, AppError> {
    run(state, move |s| s.ai_test(provider)).await
}

/// Models the account can use. `ai_not_enabled` (no traffic) before the opt-in.
#[tauri::command]
#[specta::specta]
pub async fn ai_models_list(
    state: Shared<'_>,
    provider: AiProviderDto,
) -> Result<Vec<String>, AppError> {
    run(state, move |s| s.ai_models_list(provider)).await
}

/// The weekly review, built locally: no AI, no network. `weeks_ago` 0 is the current week.
#[tauri::command]
#[specta::specta]
pub async fn review_get(state: Shared<'_>, weeks_ago: u32) -> Result<WeeklyReviewDto, AppError> {
    run(state, move |s| s.review_get(weeks_ago)).await
}

/// Saves (blank removes) the personal note of the week that starts on local day `first_day`.
#[tauri::command]
#[specta::specta]
pub async fn review_note_set(
    state: Shared<'_>,
    first_day: i64,
    note: String,
) -> Result<(), AppError> {
    run(state, move |s| s.review_note_set(first_day, &note)).await
}

/// Builds the exact request a run would send; nothing is sent. `ai_not_enabled` (no
/// traffic) before the opt-in.
#[tauri::command]
#[specta::specta]
pub async fn review_preview(
    state: Shared<'_>,
    weeks_ago: u32,
    include_titles: bool,
    language: String,
) -> Result<ReviewPreviewDto, AppError> {
    run(state, move |s| {
        s.review_preview(weeks_ago, include_titles, &language)
    })
    .await
}

/// Sends a previewed request and stores the answer. Waits for the provider (up to 60 s, 180 s
/// for Ollama) or for `review_cancel`; a failure stores nothing.
#[tauri::command]
#[specta::specta]
pub async fn review_run(
    app: AppHandle,
    state: Shared<'_>,
    preview_id: String,
) -> Result<AiReviewDto, AppError> {
    let review = run(state, move |s| s.review_run(&preview_id)).await?;
    announce_reviews_changed(&app);
    Ok(review)
}

/// Stops the analysis in progress; its command returns at once.
#[tauri::command]
#[specta::specta]
pub async fn review_cancel(state: Shared<'_>) -> Result<(), AppError> {
    run(state, |s| {
        s.review_cancel();
        Ok(())
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn ai_reviews_list(state: Shared<'_>) -> Result<Vec<AiReviewDto>, AppError> {
    run(state, AppState::ai_reviews_list).await
}

#[tauri::command]
#[specta::specta]
pub async fn ai_reviews_delete(app: AppHandle, state: Shared<'_>, id: i64) -> Result<(), AppError> {
    run(state, move |s| s.ai_reviews_delete(id)).await?;
    announce_reviews_changed(&app);
    Ok(())
}

/// Step one of "delete all reviews": the token the confirmation sends back.
#[tauri::command]
#[specta::specta]
pub async fn ai_reviews_prepare_delete_all(state: Shared<'_>) -> Result<String, AppError> {
    run(state, |s| Ok(s.ai_reviews_prepare_delete_all())).await
}

/// Step two: deletes every review; returns how many. Needs the token.
#[tauri::command]
#[specta::specta]
pub async fn ai_reviews_delete_all(
    app: AppHandle,
    state: Shared<'_>,
    token: String,
) -> Result<u32, AppError> {
    let deleted = run(state, move |s| s.ai_reviews_delete_all(&token)).await?;
    announce_reviews_changed(&app);
    Ok(deleted)
}

#[cfg(test)]
mod tests {
    /// `build.rs` declares the commands that get `allow-*` permissions; this keeps that list,
    /// the `#[tauri::command]` functions and the main window capability in step.
    #[test]
    fn declared_commands_match_the_functions_and_capabilities() {
        let source = include_str!("commands.rs");
        let build = include_str!("../../build.rs");
        let main_capability = include_str!("../../capabilities/main.json");
        let popover_capability = include_str!("../../capabilities/popover.json");
        let onboarding_capability = include_str!("../../capabilities/onboarding.json");

        let mut functions = Vec::new();
        let mut lines = source.lines().peekable();
        while let Some(line) = lines.next() {
            if line.trim() == "#[tauri::command]" {
                for next in lines.by_ref() {
                    if let Some(rest) = next.trim().strip_prefix("pub ") {
                        let rest = rest.strip_prefix("async ").unwrap_or(rest);
                        let name = rest.strip_prefix("fn ").expect("fn after attribute");
                        functions.push(name.split('(').next().unwrap().to_owned());
                        break;
                    }
                }
            }
        }
        assert!(functions.len() > 20, "found {functions:?}");
        for name in &functions {
            assert!(
                build.contains(&format!("\"{name}\",")),
                "{name} missing from build.rs COMMANDS"
            );
            let permission = format!("allow-{}", name.replace('_', "-"));
            assert!(
                main_capability.contains(&format!("\"{permission}\"")),
                "{permission} missing from capabilities/main.json"
            );
        }
        let declared = build.matches("    \"").count();
        assert_eq!(declared, functions.len(), "build.rs lists extra commands");

        // Every command permission granted by any window must name a real command, so a rename
        // cannot leave a stale grant behind (the popover/onboarding subsets included).
        let known: Vec<String> = functions
            .iter()
            .map(|name| format!("allow-{}", name.replace('_', "-")))
            .collect();
        for (file, capability) in [
            ("main.json", main_capability),
            ("popover.json", popover_capability),
            ("onboarding.json", onboarding_capability),
        ] {
            let granted: Vec<&str> = capability
                .split('"')
                .filter(|token| token.starts_with("allow-"))
                .collect();
            assert!(!granted.is_empty(), "{file} grants no commands");
            for permission in granted {
                assert!(
                    known.iter().any(|k| k == permission),
                    "{permission} in capabilities/{file} matches no command"
                );
            }
        }
    }
}
