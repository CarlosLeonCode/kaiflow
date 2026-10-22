//! Composition root: opens the database, builds every repository, starts the engine thread
//! and the background timers. This is the only place that knows concrete adapters
//! (design sections 1 and 2); everything else talks to ports.

use std::fmt;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use adapters_ai::HttpAiProvider;
use adapters_common::files::FsFileSink;
use adapters_common::idle::IdleThreshold;
use adapters_common::secrets::KeyringSecretStore;
use adapters_sqlite::{
    DbError, SqliteActivityRepository, SqliteAiReviewRepository, SqliteBackupStore,
    SqliteFocusRepository, SqliteGoalRepository, SqlitePrivacyRepository, SqliteReportRepository,
    SqliteRetentionRepository, SqliteSessionRepository, SqliteSettingsRepository,
};
use application::ai::{AiProvider, LEGACY_KEYCHAIN_SERVICE, SecretStore};
use application::commands::Commands;
use application::engine::{Command, Engine, EngineHandle, Ports};
use application::export::DataService;
use application::focus::FocusService;
use application::goals::GoalService;
use application::idle_policy::IdlePolicy;
use application::ports::{
    ActiveWindowProvider, ActivityRepository, Clock, EventSink, Notifier, PermissionProvider,
    PortResult, PowerEventsProvider, PrivacyMode, PrivacyRepository,
};
use application::presets::PresetService;
use application::queries::Queries;
use application::review::ReviewService;
use application::secret_migration::MigratingSecretStore;
use crossbeam_channel::{Receiver, Sender, bounded};
use domain::{PrivacyPolicy, UtcMs};

use crate::calendar::ChronoLocalCalendar;
use crate::error::AppError;
use crate::ipc::dto::{DisplaySessionDto, PlatformInfoDto, ShortcutStatusDto};
use crate::ipc::events::SharedShortcut;

/// Cadence of the engine heartbeat / gap-expiry tick (design section 6).
const TICK_EVERY: Duration = Duration::from_secs(2);
/// Default folder for automatic backups, next to the database inside the app data directory.
const BACKUP_DIR: &str = "backups";
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

/// Starts the OS sampler thread once the engine exists. It receives the engine handle and
/// the stop channel (closed on shutdown) and returns the thread to join.
pub type SamplerLauncher =
    Box<dyn FnOnce(EngineHandle, Receiver<()>) -> std::io::Result<JoinHandle<()>> + Send>;

/// OS-facing ports supplied by the caller: the platform adapters in production (see
/// `platform.rs`), fakes in tests.
pub struct Providers {
    pub window: Box<dyn ActiveWindowProvider>,
    pub power: Box<dyn PowerEventsProvider>,
    pub permission: Arc<dyn PermissionProvider>,
    pub notifier: Box<dyn Notifier>,
    /// Idle threshold shared with the sampler; `compose` initializes it from the settings.
    pub idle_threshold: IdleThreshold,
    /// The sampler drives focus, idle, permission checks and the heartbeat. `None` keeps a
    /// plain 2 s heartbeat thread (tests and the placeholder fallback).
    pub sampler: Option<SamplerLauncher>,
    /// Linux display server the adapters observe through (`None` elsewhere).
    pub display_session: Option<DisplaySessionDto>,
}

impl Providers {
    /// No-op providers for platforms without a native adapter, and the base for tests.
    pub fn placeholders() -> Self {
        use crate::placeholders::{AssumeGranted, NoActiveWindow, NoPowerEvents, SilentNotifier};
        Self {
            window: Box::new(NoActiveWindow),
            power: Box::new(NoPowerEvents),
            permission: Arc::new(AssumeGranted),
            notifier: Box::new(SilentNotifier),
            idle_threshold: IdleThreshold::default(),
            sampler: None,
            display_session: None,
        }
    }
}

/// Applies the settings that live outside the database (OS login item, global shortcut,
/// tray text). Implemented by the shell; `settings_update` calls it after persisting the patch.
pub trait SettingsApplier: Send + Sync {
    fn set_autostart(&self, enabled: bool) -> Result<(), AppError>;
    fn set_shortcut(&self, shortcut: &str) -> Result<(), AppError>;
    /// The tray text reads `tray_display` itself; this only asks it to recompute. Never blocks.
    fn refresh_tray_text(&self);
    /// Goals or the week start changed: the goal watcher re-evaluates. Never blocks.
    fn refresh_goals(&self) {}
    /// A focus session changed or its drift setting did: the focus watcher re-evaluates and
    /// the tray text follows. Never blocks.
    fn refresh_focus(&self) {}
}

/// The two ports of the optional AI review: the provider connections and the OS keychain.
/// Production uses [`AiPorts::native`]; tests pass fakes, so no test touches the network or
/// the keychain.
pub struct AiPorts {
    pub provider: Arc<dyn AiProvider>,
    pub secrets: Arc<dyn SecretStore>,
}

impl AiPorts {
    /// HTTP providers and the keychain of this OS. Keys saved under the service name used
    /// before the rename to Kaiflow are moved to the current one the first time they are read.
    pub fn native() -> Self {
        Self {
            provider: Arc::new(HttpAiProvider::new()),
            secrets: Arc::new(MigratingSecretStore::new(
                Arc::new(KeyringSecretStore::native()),
                Arc::new(KeyringSecretStore::native_for(LEGACY_KEYCHAIN_SERVICE)),
            )),
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
    /// Local weekday and hour for the Overview heatmap.
    pub calendar: ChronoLocalCalendar,
    pub commands: Arc<Commands>,
    /// Opt-in activity presets and app suggestions.
    pub presets: PresetService,
    /// JSON export, daily backup and restore.
    pub data: DataService,
    /// Goals, their progress and streaks (shared by the popover, Today and Overview).
    pub goals: Arc<GoalService>,
    /// Focus sessions: start, drift detection, summary and recovery.
    pub focus: Arc<FocusService>,
    /// The weekly review and its optional AI analysis.
    pub review: Arc<ReviewService>,
    /// Read-only listing of activities and rules (writes go through `commands`).
    pub activities: Arc<dyn ActivityRepository>,
    pub permission: Arc<dyn PermissionProvider>,
    /// OS and display session, for platform-specific UI copy (`platform_info`).
    pub platform: PlatformInfoDto,
    pub shortcut: SharedShortcut,
    pub clock: SystemClock,
    pub idle_threshold: IdleThreshold,
    /// Live idle-prompt policy (also read by the engine's effects executor).
    pub idle_policy: IdlePolicy,
    /// Installed by the shell after composition (it needs the `AppHandle`).
    applier: OnceLock<Arc<dyn SettingsApplier>>,
    background: Mutex<Option<Background>>,
    sampler: Mutex<Option<SamplerLauncher>>,
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
    ai: AiPorts,
) -> Result<AppState, ComposeError> {
    let sessions = SqliteSessionRepository::new(adapters_sqlite::open(db_path)?);
    // Opened after the first connection so the schema exists when the read pool starts.
    let reports = SqliteReportRepository::open(db_path)?;
    let activities: Arc<dyn ActivityRepository> = Arc::new(SqliteActivityRepository::new(
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

    let data = DataService::new(
        Arc::new(SqliteBackupStore::new(adapters_sqlite::open(db_path)?)),
        Arc::new(FsFileSink),
        settings.clone(),
        Arc::new(ChronoLocalCalendar),
        db_path.with_file_name(BACKUP_DIR),
        db_path.to_path_buf(),
        env!("CARGO_PKG_VERSION"),
    );

    let reports = Arc::new(reports);
    let queries = Queries::new(reports.clone(), activities.clone());
    let goals = Arc::new(GoalService::new(
        Arc::new(SqliteGoalRepository::new(adapters_sqlite::open(db_path)?)),
        reports.clone(),
        activities.clone(),
        settings.clone(),
        Arc::new(ChronoLocalCalendar),
    ));
    let focus = Arc::new(FocusService::new(
        Arc::new(SqliteFocusRepository::new(adapters_sqlite::open(db_path)?)),
        reports.clone(),
        activities.clone(),
        settings.clone(),
    ));
    let review = Arc::new(ReviewService::new(
        reports.clone(),
        activities.clone(),
        goals.clone(),
        Arc::new(SqliteFocusRepository::new(adapters_sqlite::open(db_path)?)),
        settings.clone(),
        Arc::new(ChronoLocalCalendar),
        ai.secrets,
        ai.provider,
        Arc::new(SqliteAiReviewRepository::new(adapters_sqlite::open(
            db_path,
        )?)),
    ));
    let presets = PresetService::new(activities.clone(), reports, settings.clone());
    let commands = Arc::new(
        Commands::new(activities.clone(), privacy.clone(), settings, retention)
            .with_streaks(goals.clone()),
    );

    let idle_policy = IdlePolicy::default();
    if let Ok(settings) = commands.get_settings() {
        idle_policy.set(
            settings.idle_prompt_timeout_secs,
            settings.idle_auto_discard_below_secs,
        );
    }
    let (engine, handle) = Engine::new(Ports {
        clock: Box::new(SystemClock),
        window: providers.window,
        sessions: Box::new(sessions),
        privacy: Box::new(SharedPrivacy(privacy)),
        sink,
        notifier: providers.notifier,
        idle_policy: idle_policy.clone(),
    });
    providers.power.subscribe(handle.signals());
    if let Ok(settings) = commands.get_settings() {
        providers.idle_threshold.set(settings.idle_threshold_secs);
    }
    let engine_thread = engine.spawn().map_err(ComposeError::Thread)?;

    let state = AppState {
        engine: handle,
        queries,
        calendar: ChronoLocalCalendar,
        commands,
        presets,
        data,
        goals,
        focus,
        review,
        activities,
        permission: providers.permission,
        platform: crate::platform_info::platform_info(
            crate::platform_info::current_os(),
            providers.display_session,
        ),
        shortcut,
        clock: SystemClock,
        idle_threshold: providers.idle_threshold,
        idle_policy,
        applier: OnceLock::new(),
        background: Mutex::new(None),
        sampler: Mutex::new(providers.sampler),
    };
    state.start_background(engine_thread)?;
    // A session left running by the previous run resumes (or closes with its summary).
    if let Err(error) = state.focus.recover(None, SystemClock.now()) {
        eprintln!("could not recover the focus session: {error}");
    }
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
    /// The applier can be installed once; a second call is ignored.
    pub fn set_applier(&self, applier: Arc<dyn SettingsApplier>) {
        let _ = self.applier.set(applier);
    }

    pub fn applier(&self) -> Option<&Arc<dyn SettingsApplier>> {
        self.applier.get()
    }

    pub fn default_shortcut() -> SharedShortcut {
        Arc::new(Mutex::new(ShortcutStatusDto::Disabled))
    }

    fn start_background(&self, engine_thread: JoinHandle<()>) -> Result<(), ComposeError> {
        let (stop, stop_rx) = bounded::<()>(0);
        let launcher = self
            .sampler
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        let ticker = match launcher {
            // The sampler also sends the heartbeat, so no separate ticker is needed.
            Some(launch) => {
                launch(self.engine.clone(), stop_rx.clone()).map_err(ComposeError::Thread)?
            }
            None => {
                let engine = self.engine.clone();
                let stop_rx = stop_rx.clone();
                std::thread::Builder::new()
                    .name("ticker".into())
                    .spawn(move || {
                        while wait_or_stop(&stop_rx, TICK_EVERY) {
                            engine.tick();
                        }
                    })
                    .map_err(ComposeError::Thread)?
            }
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
