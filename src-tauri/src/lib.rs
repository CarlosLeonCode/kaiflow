//! Tauri shell: composes the adapters with the application engine, exposes the typed IPC
//! surface and owns the tray and windows (design sections 1, 8 and 10).

pub mod api;
pub mod composition;
pub mod error;
pub mod ipc;
pub mod placeholders;
pub mod tray;
pub mod windows;

use std::path::PathBuf;
use std::sync::Arc;

use specta_typescript::Typescript;
use tauri::{Manager, RunEvent};

use crate::composition::{AppState, Providers, compose};
use crate::ipc::events::TauriEventSink;

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
        // Plugins are registered here and only invoked from Rust (R6.5).
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);

            // Menu-bar agent: no Dock icon (also set via `LSUIElement` in Info.plist).
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let data_dir = app.path().app_data_dir()?;
            let shortcut = AppState::default_shortcut();
            let sink = TauriEventSink::new(app.handle().clone(), shortcut.clone());
            let state = Arc::new(compose(
                &data_dir.join(DB_FILE),
                Box::new(sink),
                shortcut,
                Providers::placeholders(),
            )?);
            let onboarding_pending = !state.commands.get_settings()?.onboarding_completed;
            app.manage(state);

            windows::create_all(app.handle(), onboarding_pending)?;
            tray::install(app.handle())?;
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
            if let Some(state) = handle.try_state::<Arc<AppState>>() {
                state.shutdown();
            }
        }
        _ => {}
    });
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
