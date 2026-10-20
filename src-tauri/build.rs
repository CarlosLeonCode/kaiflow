//! Declares the app commands so Tauri generates `allow-<command>` permissions that the
//! per-window capabilities grant individually (design section 10).

use std::path::Path;

/// Keep in sync with `ipc::commands::collect` (a unit test enforces it).
const COMMANDS: &[&str] = &[
    "get_status",
    "start",
    "pause",
    "resume",
    "stop",
    "get_report",
    "get_timeline",
    "list_pending_idle_gaps",
    "resolve_idle_gap",
    "categories_list",
    "categories_create",
    "categories_update",
    "categories_delete",
    "rules_list",
    "rules_upsert",
    "rules_delete",
    "privacy_list",
    "privacy_set",
    "settings_get",
    "settings_update",
    "permission_status",
    "permission_request",
    "permission_open_settings",
    "app_restart",
    "open_main_window",
    "close_onboarding",
    "hide_popover",
    "prepare_delete",
    "delete_range",
    "purge_older_than",
    "delete_all",
    "export_csv",
];

fn main() {
    ensure_placeholder_frontend();
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}

/// Fallback for a clean checkout where `npm run build` has not produced `dist/` yet:
/// `tauri::generate_context!` needs `frontendDist` to exist, so seed it with the (unbuilt)
/// entry pages. `tauri build` always runs `beforeBuildCommand` first, which overwrites them
/// with the real Vite output, and an existing page is never replaced.
fn ensure_placeholder_frontend() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let dist = root.join("dist");
    for page in ["popover.html", "main.html", "onboarding.html"] {
        println!("cargo:rerun-if-changed=../{page}");
        let source = root.join(page);
        if !dist.join(page).exists() && source.exists() {
            std::fs::create_dir_all(&dist).expect("create dist/");
            std::fs::copy(&source, dist.join(page)).expect("copy placeholder page");
        }
    }
}
