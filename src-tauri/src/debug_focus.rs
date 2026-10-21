//! Dev tool, compiled into debug builds only: `KAIFLOW_DEBUG_FOCUS_SECS=<n>` starts a timer
//! of `n` seconds at launch (raised to the shortest block, one minute), so the end alert can
//! be watched from a terminal without clicking through the UI. Release builds ignore it.

use std::sync::Arc;

use application::focus::StartRequest;
use application::ports::Clock;
use domain::focus_session::MIN_PLANNED_MS;
use domain::{FocusAllowed, FocusKind};
use tauri::{AppHandle, Manager, Wry};

use crate::composition::AppState;
use crate::focus_watcher::FocusWatcher;
use crate::tray_text::TrayText;

const ENV: &str = "KAIFLOW_DEBUG_FOCUS_SECS";

/// Starts the debug timer when the variable is set. Failures are only logged.
pub fn start_from_env(app: &AppHandle<Wry>, state: &Arc<AppState>) {
    let Some(secs) = std::env::var(ENV)
        .ok()
        .and_then(|v| v.trim().parse::<i64>().ok())
    else {
        return;
    };
    let planned_ms = (secs * 1_000).max(MIN_PLANNED_MS);
    let started = state.focus.start(
        StartRequest {
            kind: FocusKind::Timer,
            intent: "Debug timer".into(),
            planned_ms,
            allowed: FocusAllowed::default(),
        },
        None,
        None,
        state.clock.now(),
    );
    match started {
        Ok(_) => eprintln!("[debug-focus] started a {planned_ms} ms timer"),
        Err(error) => eprintln!("[debug-focus] could not start the timer: {error}"),
    }
    if let Some(watcher) = app.try_state::<FocusWatcher>() {
        watcher.refresh();
    }
    if let Some(tray_text) = app.try_state::<TrayText>() {
        tray_text.refresh();
    }
}
