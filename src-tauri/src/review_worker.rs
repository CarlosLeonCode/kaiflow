//! The optional Monday review. A worker thread looks shortly after launch and then every few
//! hours whether the user switched the Monday review on and last week has no review yet;
//! the decision lives in `ReviewService::run_monday_review`, so nothing here can call an AI
//! provider unless the user enabled it. A failed attempt (offline, rate limited...) is not
//! retried until the next launch.

use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use application::review::MondayReview;
use crossbeam_channel::{RecvTimeoutError, Sender, bounded};
use tauri::{AppHandle, Wry};
use tauri_specta::Event;

use crate::composition::AppState;
use crate::ipc::events::{DataChanged, DataKindDto};

/// Waits for the app to settle (and the network to come up after a login) first.
const FIRST_CHECK_AFTER: Duration = Duration::from_secs(90);
const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

/// What the worker does after one check.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Next {
    /// Check again later.
    Later,
    /// Stop until the next launch.
    Stop,
}

/// Handle to the review thread; dropping or stopping it ends the thread.
pub struct ReviewWorker {
    stop: Mutex<Option<Sender<()>>>,
}

impl ReviewWorker {
    pub fn spawn(app: &AppHandle<Wry>, state: Arc<AppState>) -> Self {
        let (stop, stop_rx) = bounded::<()>(0);
        let app = app.clone();
        let spawned = std::thread::Builder::new()
            .name("review".into())
            .spawn(move || {
                let mut wait = FIRST_CHECK_AFTER;
                // The channel is never sent on: closing it is the stop signal.
                while matches!(stop_rx.recv_timeout(wait), Err(RecvTimeoutError::Timeout)) {
                    let next = cycle(&state, &|| {
                        let _ = DataChanged {
                            kind: DataKindDto::Reviews,
                        }
                        .emit(&app);
                    });
                    if next == Next::Stop {
                        break;
                    }
                    wait = CHECK_EVERY;
                }
            });
        if let Err(error) = spawned {
            eprintln!("could not start the review thread: {error}");
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

/// One check. Tells the windows when a review was added.
pub fn cycle(state: &AppState, announce: &dyn Fn()) -> Next {
    match state.run_monday_review() {
        MondayReview::NotDue => Next::Later,
        MondayReview::Done(_) => {
            announce();
            Next::Later
        }
        MondayReview::Failed(message) => {
            eprintln!("the Monday review could not run: {message}");
            Next::Stop
        }
    }
}
