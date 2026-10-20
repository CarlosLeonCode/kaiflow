//! In-app updates (R11.4, R10.1). The only network traffic of the app: a GET of `latest.json`
//! from the GitHub release endpoint configured in `tauri.conf.json`, and the download of the
//! signed archive when the user asks to install. Everything runs in Rust; the updater plugin
//! is never granted to a window (R6.5), the frontend uses `update_check` / `update_install`.
//!
//! The update signature is verified by the plugin against `plugins.updater.pubkey`. That key
//! comes from the config (see `docs/release.md`); while it is still the committed
//! placeholder the updater stays disabled and makes no request at all.

use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_updater::{Update, UpdaterExt};
use tauri_specta::Event;

use crate::composition::AppState;
use crate::error::AppError;
use crate::ipc::dto::UpdateInfoDto;
use crate::ipc::events::UpdateAvailable;

/// Delay of the first check: lets the windows register their event listeners first.
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(30);
/// Period of the background checks (R11.4).
const CHECK_EVERY: Duration = Duration::from_secs(24 * 60 * 60);
/// `tauri.conf.json` ships this marker until the real public key is configured.
const PLACEHOLDER_PREFIX: &str = "REPLACE_WITH_";

/// The update found by the last check, waiting for the user to install it.
#[derive(Default)]
pub struct UpdaterState {
    pending: Mutex<Option<Update>>,
}

impl UpdaterState {
    fn store(&self, update: Option<Update>) {
        *self.pending.lock().unwrap_or_else(PoisonError::into_inner) = update;
    }

    fn take(&self) -> Option<Update> {
        self.pending
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
    }
}

/// `true` when the configured public key is a real one (non-empty, not the placeholder).
pub fn is_configured(pubkey: Option<&str>) -> bool {
    pubkey.is_some_and(|key| {
        let key = key.trim();
        !key.is_empty() && !key.starts_with(PLACEHOLDER_PREFIX)
    })
}

fn configured_pubkey(app: &AppHandle<Wry>) -> Option<String> {
    app.config()
        .plugins
        .0
        .get("updater")?
        .get("pubkey")?
        .as_str()
        .map(str::to_owned)
}

fn updates_enabled(app: &AppHandle<Wry>) -> bool {
    is_configured(configured_pubkey(app).as_deref())
}

fn info_of(update: &Update) -> UpdateInfoDto {
    UpdateInfoDto {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone().filter(|body| !body.trim().is_empty()),
        date: update.date.map(|date| date.to_string()),
    }
}

fn internal(error: impl std::fmt::Display) -> AppError {
    AppError::Internal {
        message: error.to_string(),
    }
}

/// Checks the endpoint once. A newer release is remembered for `update_install` and announced
/// with `update-available`. Returns `None` when current or when updates are not configured.
pub async fn check_now(
    app: &AppHandle<Wry>,
    state: &UpdaterState,
) -> Result<Option<UpdateInfoDto>, AppError> {
    if !updates_enabled(app) {
        return Ok(None);
    }
    let update = app
        .updater()
        .map_err(internal)?
        .check()
        .await
        .map_err(internal)?;
    let info = update.as_ref().map(info_of);
    state.store(update);
    if let Some(info) = &info {
        // Best effort: a closing window must not fail the check.
        let _ = UpdateAvailable(info.clone()).emit(app);
    }
    Ok(info)
}

/// Downloads and installs the pending update, then relaunches into the new version. The open
/// segment is closed first because the relaunch does not run the normal exit path.
pub async fn install_pending(
    app: &AppHandle<Wry>,
    state: &Arc<AppState>,
    updates: &UpdaterState,
) -> Result<(), AppError> {
    let update = updates.take().ok_or_else(|| AppError::Invalid {
        message: "there is no update to install; check for updates first".into(),
    })?;
    // The plugin verifies the signature before touching the installed app.
    if let Err(error) = update.download_and_install(|_, _| {}, || {}).await {
        // Keep it so the user can retry without checking again.
        updates.store(Some(update));
        return Err(internal(error));
    }

    let state = Arc::clone(state);
    tauri::async_runtime::spawn_blocking(move || state.shutdown())
        .await
        .map_err(internal)?;
    // Same reason as `app_restart`: the new instance must not defer to this one.
    tauri_plugin_single_instance::destroy(app);
    app.restart()
}

/// Starts the background schedule: first check shortly after launch, then every 24 hours.
/// A failure (offline, server down) is logged and retried at the next tick.
pub fn spawn_schedule(app: &AppHandle<Wry>) {
    if !updates_enabled(app) {
        eprintln!("updater disabled: plugins.updater.pubkey is not configured (docs/release.md)");
        return;
    }
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("updater-schedule".into())
        .spawn(move || {
            std::thread::sleep(FIRST_CHECK_DELAY);
            loop {
                if let Some(state) = app.try_state::<UpdaterState>()
                    && let Err(error) =
                        tauri::async_runtime::block_on(check_now(&app, state.inner()))
                {
                    eprintln!("update check failed: {error}");
                }
                std::thread::sleep(CHECK_EVERY);
            }
        });
    if let Err(error) = spawned {
        eprintln!("could not start the update schedule: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholder_and_empty_keys_keep_the_updater_disabled() {
        assert!(!is_configured(None));
        assert!(!is_configured(Some("")));
        assert!(!is_configured(Some("   ")));
        assert!(!is_configured(Some("REPLACE_WITH_UPDATER_PUBLIC_KEY")));
        assert!(is_configured(Some(
            "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk="
        )));
    }

    #[test]
    fn the_committed_config_ships_the_placeholder_and_the_release_endpoint() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let updater = &conf["plugins"]["updater"];
        assert!(!is_configured(updater["pubkey"].as_str()));
        assert_eq!(
            updater["endpoints"][0],
            "https://github.com/CarlosLeonCode/time-track-copilot/releases/latest/download/latest.json"
        );
        assert_eq!(conf["bundle"]["createUpdaterArtifacts"], true);
    }

    #[test]
    fn nothing_is_pending_until_a_check_stores_an_update() {
        let state = UpdaterState::default();
        assert!(state.take().is_none());
        state.store(None);
        assert!(state.take().is_none());
    }

    #[test]
    fn checks_run_daily() {
        assert_eq!(CHECK_EVERY, Duration::from_secs(86_400));
        assert!(FIRST_CHECK_DELAY < CHECK_EVERY);
    }
}
