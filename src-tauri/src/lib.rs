//! Tauri shell: composes the adapters with the application engine, exposes the typed IPC
//! surface and owns the tray and windows (design sections 1, 8 and 10).

pub mod api;
pub mod backup_worker;
pub mod calendar;
pub mod composition;
pub mod data_migration;
#[cfg(debug_assertions)]
pub mod debug_focus;
pub mod error;
pub mod event_sink;
pub mod focus_watcher;
pub mod goal_watcher;
pub mod i18n;
pub mod ipc;
#[cfg(target_os = "macos")]
pub mod macos_notifications;
pub mod notifications;
pub mod placeholders;
pub mod platform;
pub mod platform_info;
pub mod review_api;
pub mod review_worker;
pub mod settings_applier;
pub mod shortcuts;
pub mod tray;
pub mod tray_text;
pub mod updater;
pub mod windows;

use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

use specta_typescript::Typescript;
use tauri::{AppHandle, Manager, RunEvent, Wry};

use crate::composition::{AiPorts, AppState, compose};
use crate::settings_applier::{ShellApplier, TauriLoginItem, reconcile};
use crate::shortcuts::{ShortcutManager, TauriRegistrar, announce_to_frontend};

const DB_FILE: &str = "kaiflow.db";

/// Absolute path of the generated `bindings.ts`.
pub fn bindings_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(ipc::BINDINGS_PATH)
}

/// Writes `bindings.ts`; also used by the regeneration test and by debug runs.
pub fn export_bindings(path: &std::path::Path) -> Result<(), specta_typescript::Error> {
    ipc::builder().export(Typescript::default(), path)
}

pub fn run() {
    #[cfg(target_os = "linux")]
    avoid_blank_webkit_windows();

    let builder = ipc::builder();

    #[cfg(debug_assertions)]
    if let Err(error) = export_bindings(&bindings_path()) {
        eprintln!("could not export bindings.ts: {error}");
    }

    // Where a failed `setup` was logged, for the error dialog.
    let startup_log: Arc<OnceLock<PathBuf>> = Arc::default();
    let setup_log = startup_log.clone();
    let built = tauri::Builder::default()
        // Single-instance must be the first plugin (R6.4): a second launch focuses the
        // running app instead of starting another engine.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_on_second_launch(app);
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
            let result = setup(app, &builder);
            if let Err(error) = &result
                && let Some(log) = record_startup_failure(app, error.as_ref())
            {
                let _ = setup_log.set(log);
            }
            result
        })
        .build(tauri::generate_context!());
    // Without a console (Windows release) a failed start would just vanish: say so instead.
    let app = match built {
        Ok(app) => app,
        Err(error) => fail_to_start(&error, startup_log.get().map(PathBuf::as_path)),
    };

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
            if let Some(focus) = handle.try_state::<focus_watcher::FocusWatcher>() {
                focus.stop();
            }
            if let Some(worker) = handle.try_state::<backup_worker::BackupWorker>() {
                worker.stop();
            }
            if let Some(worker) = handle.try_state::<review_worker::ReviewWorker>() {
                worker.stop();
            }
            if let Some(state) = handle.try_state::<Arc<AppState>>() {
                state.shutdown();
            }
        }
        _ => {}
    });
}

/// Composes the app: adapters, engine, state, windows, tray and background workers. Runs on
/// the main thread, where the AppKit observers must be created. An error ends the startup
/// (see [`fail_to_start`]).
fn setup(
    app: &mut tauri::App<Wry>,
    builder: &tauri_specta::Builder<Wry>,
) -> Result<(), Box<dyn std::error::Error>> {
    builder.mount_events(app);

    // Menu-bar agent: no Dock icon (also set via `LSUIElement` in Info.plist).
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

    let handle = app.handle().clone();
    let data_dir = app.path().app_data_dir()?;
    // Privacy-safe log (never window titles): `diagnostics.log` next to the DB. A
    // Windows release has no console, so failures are written there too.
    let diagnostics = adapters_common::diagnostics::Diagnostics::in_dir(&data_dir);
    carry_over_legacy_data(&data_dir, &diagnostics);
    let shortcut = AppState::default_shortcut();
    // `setup` runs on the main thread, where the AppKit observers must be created.
    let language = composition::native_language();
    let providers = platform::providers(&handle, &diagnostics, &language);
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
        AiPorts::native(),
        language,
    )?);
    state.set_diagnostics(diagnostics);
    let settings = state.commands.get_settings()?;
    app.manage(state.clone());
    app.manage(updater::UpdaterState::default());
    app.manage(windows::PendingSection::default());

    windows::create_all(
        &handle,
        !settings.onboarding_completed,
        i18n::messages(state.language.current()),
    )?;
    tray::install(&handle)?;
    let tray_text = tray_text::TrayText::spawn(&handle);
    app.manage(tray_text.clone());
    app.manage(backup_worker::BackupWorker::spawn(&handle, state.clone()));
    app.manage(review_worker::ReviewWorker::spawn(&handle, state.clone()));
    let goal_watcher = goal_watcher::GoalWatcher::spawn(&handle, state.language.clone());
    app.manage(goal_watcher.clone());
    let focus_watcher = focus_watcher::FocusWatcher::spawn(&handle, state.language.clone());
    app.manage(focus_watcher.clone());
    apply_outside_settings(
        &handle,
        &state,
        &shortcut,
        &settings,
        tray_text,
        goal_watcher,
        focus_watcher,
    );
    updater::spawn_schedule(&handle);
    #[cfg(debug_assertions)]
    debug_focus::start_from_env(&handle, &state);

    // Spec R6.3 scenario: after login the app registers on its own. Before the
    // onboarding is done there is no permission yet, so tracking waits for it.
    if settings.onboarding_completed
        && let Err(error) = state.start()
    {
        state.diagnostics().record_failure(
            "startup",
            &format!("could not start tracking at launch: {error}"),
        );
    }
    Ok(())
}

/// Writes a failed startup to `diagnostics.log`; the path of the log when there is a data
/// directory to hold it.
fn record_startup_failure(app: &tauri::App<Wry>, error: &dyn std::error::Error) -> Option<PathBuf> {
    let Ok(data_dir) = app.path().app_data_dir() else {
        eprintln!("Kaiflow could not start: {error}");
        return None;
    };
    let diagnostics = adapters_common::diagnostics::Diagnostics::in_dir(&data_dir);
    diagnostics.record_failure("startup", &format!("Kaiflow could not start: {error}"));
    diagnostics.path().map(std::path::Path::to_path_buf)
}

/// Kaiflow cannot run (the database, a window or the tray could not be created): a native
/// dialog says so in plain words, in the system language, then the process exits with code 1.
/// The dialog does not need the event loop, which never runs after a failed `setup`.
fn fail_to_start(error: &tauri::Error, log: Option<&std::path::Path>) -> ! {
    eprintln!("Kaiflow could not start: {error}");
    let m = i18n::messages(composition::native_language().current());
    let log = log.map(|path| path.display().to_string());
    let _ = rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Error)
        .set_title(m.startup_failed_title)
        .set_description((m.startup_failed_body)(&error.to_string(), log.as_deref()))
        .set_buttons(rfd::MessageButtons::Ok)
        .show();
    std::process::exit(1);
}

/// WebKitGTK's DMA-BUF renderer shows blank white windows with NVIDIA drivers and on some
/// Wayland compositors. Turning it off is the usual Tauri workaround and costs little for a
/// small UI. A value the user set (for example `0` to keep the renderer) is respected.
#[cfg(target_os = "linux")]
fn avoid_blank_webkit_windows() {
    const VAR: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
    if std::env::var_os(VAR).is_none() {
        // SAFETY: this runs first in `run`, before Tauri or any other thread starts, so no
        // other thread reads or writes the environment at the same time.
        unsafe { std::env::set_var(VAR, "1") };
    }
}

/// Which window a second launch brings forward: the welcome while the onboarding is pending
/// (`Some(true)`), the dashboard otherwise, including before the settings can be read.
fn second_launch_window(onboarding_pending: Option<bool>) -> &'static str {
    if onboarding_pending == Some(true) {
        windows::ONBOARDING
    } else {
        windows::MAIN
    }
}

/// A second launch focuses the running app instead of starting another engine (R6.4).
fn show_on_second_launch(app: &AppHandle<Wry>) {
    let state = app.try_state::<Arc<AppState>>();
    let pending = state
        .as_ref()
        .and_then(|state| state.commands.get_settings().ok())
        .map(|settings| !settings.onboarding_completed);
    if second_launch_window(pending) == windows::ONBOARDING {
        let language = state.map_or(application::language::Language::En, |state| {
            state.language.current()
        });
        windows::show_onboarding(app, i18n::messages(language));
    } else {
        windows::show_main(app);
    }
}

/// Brings the data of the app's former identity over before SQLite opens the database.
/// A failure is logged and the app starts with what the new directory holds: the old
/// directory is never touched, so nothing is lost and the next launch tries again.
fn carry_over_legacy_data(
    data_dir: &std::path::Path,
    diagnostics: &adapters_common::diagnostics::Diagnostics,
) {
    let legacy_dir = data_migration::legacy_data_dir(data_dir);
    match data_migration::migrate_legacy_data(
        data_dir,
        DB_FILE,
        &legacy_dir,
        data_migration::LEGACY_DB_FILE,
    ) {
        Ok(data_migration::Outcome::Migrated { from, files }) => eprintln!(
            "copied {files} files of earlier data from {} to {}; the old folder is kept as a fallback",
            from.display(),
            data_dir.display()
        ),
        Ok(_) => {}
        Err(error) => diagnostics.record_failure(
            "data-migration",
            &format!(
                "could not copy earlier data from {}: {error}",
                legacy_dir.display()
            ),
        ),
    }
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
    focus_watcher: focus_watcher::FocusWatcher,
) {
    let press_handle = handle.clone();
    let shortcuts = Arc::new(
        ShortcutManager::new(
            Box::new(TauriRegistrar::new(handle.clone())),
            shortcut.clone(),
            announce_to_frontend(handle.clone()),
            Arc::new(move || tray::toggle_tracking(&press_handle)),
        )
        .blocked_by(shortcuts::session_blocker()),
    );
    let diagnostics = state.diagnostics();
    if let Err(error) = shortcuts.apply(&settings.shortcut) {
        diagnostics.record_failure("shortcut", &error);
    }

    let login = TauriLoginItem::new(handle.clone());
    if let Err(error) = reconcile(&login, settings.autostart) {
        diagnostics.record_failure(
            "autostart",
            &format!("could not be aligned with the settings: {error}"),
        );
    }
    state.set_applier(Arc::new(ShellApplier::new(
        handle.clone(),
        Box::new(login),
        shortcuts,
        tray_text,
        goal_watcher,
        focus_watcher,
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
            "src/shared/ipc/bindings.ts is stale: run `UPDATE_BINDINGS=1 cargo test -p kaiflow generated_bindings`"
        );
    }

    #[test]
    fn a_second_launch_shows_the_welcome_until_the_onboarding_is_done() {
        assert_eq!(second_launch_window(Some(true)), windows::ONBOARDING);
        assert_eq!(second_launch_window(Some(false)), windows::MAIN);
        assert_eq!(second_launch_window(None), windows::MAIN);
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
