//! Composition root: opens the database, builds every repository, starts the engine thread
//! and the background timers. This is the only place that knows concrete adapters
//! (design sections 1 and 2); everything else talks to ports.

use std::fmt;
use std::path::Path;
use std::sync::{Arc, Mutex, PoisonError};
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use adapters_sqlite::{
    DbError, SqliteCategoryRepository, SqlitePrivacyRepository, SqliteReportRepository,
    SqliteRetentionRepository, SqliteSessionRepository, SqliteSettingsRepository,
};
use application::commands::Commands;
use application::engine::{Command, Engine, EngineHandle, Ports};
use application::ports::{
    ActiveWindowProvider, CategoryRepository, Clock, EventSink, IdleProvider, Notifier,
    PermissionProvider, PortResult, PowerEventsProvider, PrivacyMode, PrivacyRepository,
};
use application::queries::Queries;
use crossbeam_channel::{Receiver, Sender, bounded};
use domain::{PrivacyPolicy, UtcMs};

use crate::ipc::dto::ShortcutStatusDto;
use crate::ipc::events::SharedShortcut;

/// Cadence of the engine heartbeat / gap-expiry tick (design section 6).
const TICK_EVERY: Duration = Duration::from_secs(2);
/// Scheduled retention purge period (design section 7).
const PURGE_EVERY: Duration = Duration::from_secs(24 * 60 * 60);

/// Wall clock in UTC milliseconds.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> UtcMs {
        let ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX));
        UtcMs(ms)
    }
}

/// OS-facing ports supplied by the caller: macOS adapters in production, fakes in tests.
pub struct Providers {
    pub window: Box<dyn ActiveWindowProvider>,
    /// Read by the sampler (task 2.4); the engine itself does not poll it.
    pub idle: Box<dyn IdleProvider>,
    pub power: Box<dyn PowerEventsProvider>,
    pub permission: Arc<dyn PermissionProvider>,
    pub notifier: Box<dyn Notifier>,
}

impl Providers {
    /// TEMPORARY no-op providers until the macOS adapters are wired (next batch).
    pub fn placeholders() -> Self {
        use crate::placeholders::{
            AssumeGranted, NoActiveWindow, NoIdle, NoPowerEvents, SilentNotifier,
        };
        Self {
            window: Box::new(NoActiveWindow),
            idle: Box::new(NoIdle),
            power: Box::new(NoPowerEvents),
            permission: Arc::new(AssumeGranted),
            notifier: Box::new(SilentNotifier),
        }
    }
}

#[derive(Debug)]
pub enum ComposeError {
    Db(DbError),
    Thread(std::io::Error),
}

impl fmt::Display for ComposeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Db(e) => write!(f, "database: {e}"),
            Self::Thread(e) => write!(f, "could not start a thread: {e}"),
        }
    }
}

impl std::error::Error for ComposeError {}

impl From<DbError> for ComposeError {
    fn from(e: DbError) -> Self {
        Self::Db(e)
    }
}

/// Everything the IPC commands need; managed by Tauri as `Arc<AppState>`.
pub struct AppState {
    pub engine: EngineHandle,
    pub queries: Queries,
    pub commands: Arc<Commands>,
    /// Read-only listing of categories and rules (writes go through `commands`).
    pub categories: Arc<dyn CategoryRepository>,
    pub permission: Arc<dyn PermissionProvider>,
    pub shortcut: SharedShortcut,
    pub clock: SystemClock,
    background: Mutex<Option<Background>>,
}

struct Background {
    stop: Sender<()>,
    threads: Vec<JoinHandle<()>>,
}

/// Opens (and migrates) the database at `db_path`, then starts the engine and timers.
pub fn compose(
    db_path: &Path,
    sink: Box<dyn EventSink>,
    shortcut: SharedShortcut,
    providers: Providers,
) -> Result<AppState, ComposeError> {
    let sessions = SqliteSessionRepository::new(adapters_sqlite::open(db_path)?);
    // Opened after the first connection so the schema exists when the read pool starts.
    let reports = SqliteReportRepository::open(db_path)?;
    let categories: Arc<dyn CategoryRepository> = Arc::new(SqliteCategoryRepository::new(
        adapters_sqlite::open(db_path)?,
    ));
    let settings = Arc::new(SqliteSettingsRepository::new(adapters_sqlite::open(
        db_path,
    )?));
    let retention = Arc::new(SqliteRetentionRepository::new(adapters_sqlite::open(
        db_path,
    )?));
    let privacy: Arc<dyn PrivacyRepository> = Arc::new(SqlitePrivacyRepository::new(
        adapters_sqlite::open(db_path)?,
    ));

    let queries = Queries::new(Arc::new(reports), categories.clone());
    let commands = Arc::new(Commands::new(
        categories.clone(),
        privacy.clone(),
        settings,
        retention,
    ));

    let (engine, handle) = Engine::new(Ports {
        clock: Box::new(SystemClock),
        window: providers.window,
        sessions: Box::new(sessions),
        privacy: Box::new(SharedPrivacy(privacy)),
        sink,
        notifier: providers.notifier,
    });
    providers.power.subscribe(handle.signals());
    let engine_thread = engine.spawn().map_err(ComposeError::Thread)?;

    let state = AppState {
        engine: handle,
        queries,
        commands,
        categories,
        permission: providers.permission,
        shortcut,
        clock: SystemClock,
        background: Mutex::new(None),
    };
    state.start_background(engine_thread)?;
    Ok(state)
}

/// The engine owns a boxed privacy repository while the commands share the same one.
struct SharedPrivacy(Arc<dyn PrivacyRepository>);

impl PrivacyRepository for SharedPrivacy {
    fn load_policy(&self) -> PortResult<PrivacyPolicy> {
        self.0.load_policy()
    }
    fn set_mode(&self, app_id: &str, mode: Option<PrivacyMode>) -> PortResult<()> {
        self.0.set_mode(app_id, mode)
    }
}

impl AppState {
    pub fn default_shortcut() -> SharedShortcut {
        Arc::new(Mutex::new(ShortcutStatusDto::Disabled))
    }

    fn start_background(&self, engine_thread: JoinHandle<()>) -> Result<(), ComposeError> {
        let (stop, stop_rx) = bounded::<()>(0);
        let ticker = {
            let engine = self.engine.clone();
            let stop_rx = stop_rx.clone();
            std::thread::Builder::new()
                .name("ticker".into())
                .spawn(move || {
                    // TEMPORARY: the macOS sampler (task 2.4) takes over the heartbeat.
                    while wait_or_stop(&stop_rx, TICK_EVERY) {
                        engine.tick();
                    }
                })
                .map_err(ComposeError::Thread)?
        };
        let purge = {
            let commands = self.commands.clone();
            std::thread::Builder::new()
                .name("retention".into())
                .spawn(move || {
                    loop {
                        // Errors are ignored: the purge is retried on the next period.
                        let _ = commands.run_scheduled_purge(SystemClock.now());
                        if !wait_or_stop(&stop_rx, PURGE_EVERY) {
                            break;
                        }
                    }
                })
                .map_err(ComposeError::Thread)?
        };
        *self
            .background
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Some(Background {
            stop,
            threads: vec![engine_thread, ticker, purge],
        });
        Ok(())
    }

    /// Stops the timers, closes the open segment (`Shutdown`) and joins every thread.
    pub fn shutdown(&self) {
        let background = self
            .background
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        let Some(background) = background else {
            return;
        };
        drop(background.stop);
        // Ignore a dead engine: shutting down twice must stay harmless.
        let _ = self.engine.request(Command::Shutdown);
        for thread in background.threads {
            let _ = thread.join();
        }
    }
}

/// Sleeps for `period`; returns `false` as soon as the stop channel is closed.
fn wait_or_stop(stop: &Receiver<()>, period: Duration) -> bool {
    matches!(
        stop.recv_timeout(period),
        Err(crossbeam_channel::RecvTimeoutError::Timeout)
    )
}
