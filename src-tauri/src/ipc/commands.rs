//! `#[tauri::command]` wrappers. Each one runs its use case from `api.rs` on the blocking
//! pool so SQLite and engine round trips never stall the main thread, and maps failures to
//! `AppError`. Plugins (dialog) are only ever called from here, never from a window (R6.5).

use std::sync::Arc;

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_specta::Event;

use super::dto::{
    ActivityDto, ApplyPresetResultDto, DashboardDto, DeleteOpDto, IdleGapDto, IdleResolutionDto,
    PermissionStateDto, PresetDto, PrivacyModeDto, PrivacyRulesDto, ProductivityDto, RangeDto,
    ReportDto, RuleDto, RuleInputDto, SettingsDto, SettingsPatchDto, SuggestionDto,
    TimelineItemDto, TrackingStatusDto, UpdateInfoDto,
};
use super::events::{DataChanged, DataKindDto};
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

/// Asks where to save (native dialog, from Rust) and writes the CSV there. Returns the
/// chosen path, or `null` when the user cancelled.
#[tauri::command]
#[specta::specta]
pub async fn export_csv(
    app: AppHandle,
    state: Shared<'_>,
    range: RangeDto,
) -> Result<Option<String>, AppError> {
    let csv = run(state, move |s| s.csv_for(range)).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(chosen) = app
            .dialog()
            .file()
            .add_filter("CSV", &["csv"])
            .set_file_name("time-track.csv")
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = chosen.into_path().map_err(|e| AppError::Internal {
            message: e.to_string(),
        })?;
        std::fs::write(&path, csv).map_err(|e| AppError::Internal {
            message: e.to_string(),
        })?;
        Ok(Some(path.display().to_string()))
    })
    .await
    .map_err(|e| AppError::Internal {
        message: e.to_string(),
    })?
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
