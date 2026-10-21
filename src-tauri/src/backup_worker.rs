//! The automatic daily backup. A worker thread checks shortly after launch and then every
//! hour whether today's backup (local day) exists yet; the first check after local midnight
//! therefore makes it. The decision lives in `DataService::run_scheduled_backup`; this file
//! only schedules it and tells the windows how it went.

use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use application::export::ScheduledBackup;
use crossbeam_channel::{RecvTimeoutError, Sender, bounded};
use tauri::{AppHandle, Wry};
use tauri_specta::Event;

use crate::composition::AppState;
use crate::ipc::events::BackupFinished;

/// Gives the app time to settle before the first (heaviest) snapshot.
const FIRST_CHECK_AFTER: Duration = Duration::from_secs(20);
const CHECK_EVERY: Duration = Duration::from_secs(60 * 60);

/// Handle to the backup thread; dropping or stopping it ends the thread.
pub struct BackupWorker {
    stop: Mutex<Option<Sender<()>>>,
}

impl BackupWorker {
    pub fn spawn(app: &AppHandle<Wry>, state: Arc<AppState>) -> Self {
        let (stop, stop_rx) = bounded::<()>(0);
        let app = app.clone();
        let spawned = std::thread::Builder::new()
            .name("backup".into())
            .spawn(move || {
                let mut wait = FIRST_CHECK_AFTER;
                // The channel is never sent on: closing it is the stop signal.
                while matches!(stop_rx.recv_timeout(wait), Err(RecvTimeoutError::Timeout)) {
                    cycle(&state, &|event| {
                        let _ = event.emit(&app);
                    });
                    wait = CHECK_EVERY;
                }
            });
        if let Err(error) = spawned {
            eprintln!("could not start the backup thread: {error}");
        }
        Self {
            stop: Mutex::new(Some(stop)),
        }
    }

    pub fn stop(&self) {
        self.stop
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
    }
}

/// One scheduled check. Reports success, and only the first failure of a streak (the rest
/// stay visible in Settings > Data without nagging every hour).
pub fn cycle(state: &AppState, emit: &dyn Fn(BackupFinished)) {
    match state.run_scheduled_backup() {
        Ok(ScheduledBackup::Done(report)) => emit(BackupFinished {
            ok: true,
            message: report.path.display().to_string(),
        }),
        Ok(ScheduledBackup::Failed {
            message,
            first: true,
        }) => emit(BackupFinished { ok: false, message }),
        Ok(ScheduledBackup::Failed { .. } | ScheduledBackup::Skipped) => {}
        Err(error) => eprintln!("backup check failed: {error}"),
    }
}
