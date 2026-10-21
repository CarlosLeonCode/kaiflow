//! Tauri shell: composes the adapters with the application engine, exposes the typed IPC
//! surface and owns the tray and windows (design sections 1, 8 and 10).

pub mod api;
pub mod backup_worker;
pub mod calendar;
pub mod composition;
pub mod error;
pub mod event_sink;
pub mod goal_watcher;
pub mod ipc;
pub mod notifications;
pub mod placeholders;
pub mod platform;
pub mod settings_applier;
pub mod shortcuts;
pub mod tray;
pub mod tray_text;
pub mod updater;
pub mod windows;

use std::path::PathBuf;
use std::sync::Arc;

use specta_typescript::Typescript;
use tauri::{AppHandle, Manager, RunEvent, Wry};

use crate::composition::{AppState, compose};
use crate::settings_applier::{ShellApplier, TauriLoginItem, reconcile};
use crate::shortcuts::{ShortcutManager, TauriRegistrar, announce_to_frontend};

const DB_FILE: &str = "timetrack.db";

/// Absolute path of the generated `bindings.ts`.
pub fn bindings_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(ipc::BINDINGS_PATH)
}

/// Writes `bindings.ts`; also used by the regeneration test and by debug runs.
pub fn export_bindings(path: &std::path::Path) -> Result<(), specta_typescript::Error> {
    ipc::builder().export(Typescript::default(), path)
}

pub fn run() {
    let builder = ipc::builder();

    #[cfg(debug_assertions)]
    if let Err(error) = export_bindings(&bindings_path()) {
        eprintln!("could not export bindings.ts: {error}");
    }

    let app = tauri::Builder::default()
        // Single-instance must be the first plugin (R6.4): a second launch focuses the
        // running app instead of starting another engine.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            windows::show_main(app);
        }))
        // Plugins are registered here and only invoked from Rust (R6.5): no capability file
        // grants any plugin permission to a window.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);

            // Menu-bar agent: no Dock icon (also set via `LSUIElement` in Info.plist).
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            let data_dir = app.path().app_data_dir()?;
            let shortcut = AppState::default_shortcut();
            // `setup` runs on the main thread, where the AppKit observers must be created.
            let providers = platform::providers(&handle);
            let degraded_reason = providers.permission.degraded_reason().into();
            let state = Arc::new(compose(
                &data_dir.join(DB_FILE),
                Box::new(event_sink::tauri_sink(
                    &handle,
                    shortcut.clone(),
                    degraded_reason,
                )),
                shortcut.clone(),
                providers,
            )?);
            let settings = state.commands.get_settings()?;
            app.manage(state.clone());
            app.manage(updater::UpdaterState::default());

            windows::create_all(&handle, !settings.onboarding_completed)?;
            tray::install(&handle)?;
            let tray_text = tray_text::TrayText::spawn(&handle);
            app.manage(tray_text.clone());
            app.manage(backup_worker::BackupWorker::spawn(&handle, state.clone()));
            let goal_watcher = goal_watcher::GoalWatcher::spawn(&handle);
            app.manage(goal_watcher.clone());
            apply_outside_settings(
                &handle,
                &state,
                &shortcut,
                &settings,
                tray_text,
                goal_watcher,
            );
            updater::spawn_schedule(&handle);

            // Spec R6.3 scenario: after login the app registers on its own. Before the
            // onboarding is done there is no permission yet, so tracking waits for it.
            if settings.onboarding_completed
                && let Err(error) = state.start()
            {
                eprintln!("could not start tracking at launch: {error}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Tauri application");

    app.run(|handle, event| match event {
        // Closing every window must not quit a menu-bar app; only an explicit exit does.
        RunEvent::ExitRequested {
            api, code: None, ..
        } => api.prevent_exit(),
        RunEvent::Exit => {
            if let Some(tray_text) = handle.try_state::<tray_text::TrayText>() {
                tray_text.stop();
            }
            if let Some(goals) = handle.try_state::<goal_watcher::GoalWatcher>() {
                goals.stop();
            }
            if let Some(worker) = handle.try_state::<backup_worker::BackupWorker>() {
                worker.stop();
            }
            if let Some(state) = handle.try_state::<Arc<AppState>>() {
                state.shutdown();
            }
        }
        _ => {}
    });
}

/// Registers the global shortcut and aligns the login item with the stored settings, then
/// installs the applier `settings_update` uses from now on. Failures only degrade the
/// feature: the shortcut status carries the reason and the rest of the app keeps working.
fn apply_outside_settings(
    handle: &AppHandle<Wry>,
    state: &Arc<AppState>,
    shortcut: &crate::ipc::events::SharedShortcut,
    settings: &application::commands::Settings,
    tray_text: tray_text::TrayText,
    goal_watcher: goal_watcher::GoalWatcher,
) {
    let press_handle = handle.clone();
    let shortcuts = Arc::new(ShortcutManager::new(
        Box::new(TauriRegistrar::new(handle.clone())),
        shortcut.clone(),
        announce_to_frontend(handle.clone()),
        Arc::new(move || tray::toggle_tracking(&press_handle)),
    ));
    if let Err(error) = shortcuts.apply(&settings.shortcut) {
        eprintln!("{error}");
    }

    let login = TauriLoginItem::new(handle.clone());
    if let Err(error) = reconcile(&login, settings.autostart) {
        eprintln!("autostart could not be aligned with the settings: {error}");
    }
    state.set_applier(Arc::new(ShellApplier::new(
        Box::new(login),
        shortcuts,
        tray_text,
        goal_watcher,
    )));
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `bindings.ts` is generated, never hand-edited. Run with `UPDATE_BINDINGS=1` to
    /// regenerate it; otherwise the test fails when the committed file is stale (CI check).
    #[test]
    fn generated_bindings_are_current() {
        let committed = bindings_path();
        let dir = tempfile::tempdir().unwrap();
        let fresh_path = dir.path().join("bindings.ts");
        export_bindings(&fresh_path).unwrap();
        let fresh = std::fs::read_to_string(&fresh_path).unwrap();

        if std::env::var_os("UPDATE_BINDINGS").is_some() {
            std::fs::create_dir_all(committed.parent().unwrap()).unwrap();
            std::fs::write(&committed, &fresh).unwrap();
            return;
        }
        let current = std::fs::read_to_string(&committed).unwrap_or_default();
        assert_eq!(
            current, fresh,
            "src/shared/ipc/bindings.ts is stale: run `UPDATE_BINDINGS=1 cargo test -p time-track-app generated_bindings`"
        );
    }

    #[test]
    fn bindings_expose_commands_events_and_the_error_union() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bindings.ts");
        export_bindings(&path).unwrap();
        let ts = std::fs::read_to_string(path).unwrap();
        for needle in [
            "getStatus",
            "resolveIdleGap",
            "prepareDelete",
            "trackingStatusChanged",
            "storageFailed",
            "confirmation_required",
        ] {
            assert!(ts.contains(needle), "bindings.ts lacks `{needle}`");
        }
    }
}
