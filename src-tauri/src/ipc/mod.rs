//! Typed IPC surface: commands, events and DTOs, collected into one tauri-specta builder
//! that both the running app and the bindings generator use.

pub mod commands;
pub mod dto;
pub mod events;

use tauri::Wry;
use tauri_specta::{Builder, collect_commands, collect_events};

use self::events::{
    CurrentSegmentChanged, DataChanged, IdleGapPending, IdleGapResolved, PermissionChanged,
    ShortcutStatusChanged, StorageFailed, TrackingStatusChanged,
};

/// Where the generated bindings live, relative to `src-tauri/` (design section 8).
pub const BINDINGS_PATH: &str = "../src/shared/ipc/bindings.ts";

/// Builder holding every command and event. Keep `build.rs` `COMMANDS` in sync.
pub fn builder() -> Builder<Wry> {
    Builder::<Wry>::new()
        .commands(collect_commands![
            commands::get_status,
            commands::start,
            commands::pause,
            commands::resume,
            commands::stop,
            commands::get_report,
            commands::get_timeline,
            commands::list_pending_idle_gaps,
            commands::resolve_idle_gap,
            commands::categories_list,
            commands::categories_create,
            commands::categories_update,
            commands::categories_delete,
            commands::rules_list,
            commands::rules_upsert,
            commands::rules_delete,
            commands::privacy_list,
            commands::privacy_set,
            commands::settings_get,
            commands::settings_update,
            commands::permission_status,
            commands::permission_request,
            commands::permission_open_settings,
            commands::app_restart,
            commands::prepare_delete,
            commands::delete_range,
            commands::purge_older_than,
            commands::delete_all,
            commands::export_csv,
        ])
        .events(collect_events![
            TrackingStatusChanged,
            CurrentSegmentChanged,
            IdleGapPending,
            IdleGapResolved,
            PermissionChanged,
            ShortcutStatusChanged,
            DataChanged,
            StorageFailed,
        ])
        // Timestamps are UTC milliseconds (about 1.8e12), far below 2^53.
        .dangerously_cast_bigints_to_number()
}
