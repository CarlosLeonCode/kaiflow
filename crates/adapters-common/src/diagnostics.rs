//! Privacy-safe diagnostics: a small rolling log file (`diagnostics.log` in the app data
//! directory) plus the latest window-title read status per application, so a user can tell
//! why titles are missing or why time was tracked while the screen was locked.
//!
//! Privacy (AGENTS.md invariant 4): nothing here can carry a window title. Every recorded
//! value is either a bundle id / application id, a `&'static str` chosen by the adapter
//! (attribute names, error labels), a numeric OS error code, a boolean or a timestamp.
//! [`SystemSignal::Focus`] (which contains titles) is never logged.

use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use application::ports::SystemSignal;
use crossbeam_channel::{Sender, unbounded};
use domain::{PermissionState, UtcMs};

/// File name inside the app data directory.
pub const DIAGNOSTICS_FILE: &str = "diagnostics.log";
/// Each file is capped at this size; one rotated file is kept, so the total stays ~256 KB.
pub const MAX_FILE_BYTES: u64 = 128 * 1024;
/// Applications whose last title read is remembered (oldest entries are dropped).
const MAX_APPS: usize = 64;

/// Outcome of one attempt to read the focused window title. Only static strings and codes:
/// a title can never be stored in it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TitleProbe {
    /// The process may not read titles (macOS Accessibility not trusted).
    NotTrusted,
    /// A non-empty title was read through this attribute path.
    Read { via: &'static str },
    /// A window was found through `via` but its title is empty.
    Empty { via: &'static str },
    /// The OS call `step` failed with `code` (`label` is its symbolic name).
    Failed {
        step: &'static str,
        code: i32,
        label: &'static str,
    },
}

impl TitleProbe {
    pub fn is_ok(&self) -> bool {
        matches!(self, Self::Read { .. })
    }

    /// One-line, title-free description.
    pub fn describe(&self) -> String {
        match self {
            Self::NotTrusted => "skipped: not trusted for Accessibility".into(),
            Self::Read { via } => format!("ok via {via}"),
            Self::Empty { via } => format!("empty title via {via}"),
            Self::Failed { step, code, label } => format!("error {code} ({label}) at {step}"),
        }
    }
}

/// Latest title read status of one application.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TitleReadStatus {
    pub app_id: String,
    pub probe: TitleProbe,
    pub at: UtcMs,
}

/// What the Settings panel shows.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DiagnosticsSnapshot {
    /// `None` until the sampler checked once (or on platforms without a trust check).
    pub trusted: Option<bool>,
    /// Most recent first.
    pub title_reads: Vec<TitleReadStatus>,
}

#[derive(Default)]
struct State {
    trusted: Option<bool>,
    titles: BTreeMap<String, (TitleProbe, UtcMs)>,
}

struct Inner {
    path: Option<PathBuf>,
    max_bytes: u64,
    state: Mutex<State>,
    /// Serializes appends and rotation.
    file: Mutex<()>,
}

/// Cheap to clone; every clone writes to the same log.
#[derive(Clone)]
pub struct Diagnostics(Arc<Inner>);

impl std::fmt::Debug for Diagnostics {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Diagnostics")
            .field("path", &self.0.path)
            .finish_non_exhaustive()
    }
}

impl Default for Diagnostics {
    fn default() -> Self {
        Self::in_memory()
    }
}

impl Diagnostics {
    /// Logs to `dir/diagnostics.log` (rotated to `diagnostics.log.1`).
    pub fn in_dir(dir: &Path) -> Self {
        Self::with_file(dir.join(DIAGNOSTICS_FILE), MAX_FILE_BYTES)
    }

    pub fn with_file(path: PathBuf, max_bytes: u64) -> Self {
        Self(Arc::new(Inner {
            path: Some(path),
            max_bytes,
            state: Mutex::default(),
            file: Mutex::new(()),
        }))
    }

    /// Keeps the in-memory status only (tests, platforms without a data directory).
    pub fn in_memory() -> Self {
        Self(Arc::new(Inner {
            path: None,
            max_bytes: MAX_FILE_BYTES,
            state: Mutex::default(),
            file: Mutex::new(()),
        }))
    }

    pub fn path(&self) -> Option<&Path> {
        self.0.path.as_deref()
    }

    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.0.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Records the trust state; only a change is written to the log.
    pub fn record_trust(&self, trusted: bool, now: UtcMs) {
        let changed = {
            let mut state = self.state();
            let changed = state.trusted != Some(trusted);
            state.trusted = Some(trusted);
            changed
        };
        if changed {
            let word = if trusted { "yes" } else { "no" };
            self.append(now, &format!("accessibility trusted={word}"));
        }
    }

    /// Records the title read status of `app_id`; only a change per app is logged, so the
    /// 2 s sampler does not flood the file.
    pub fn record_title(&self, app_id: &str, probe: TitleProbe, now: UtcMs) {
        let changed = {
            let mut state = self.state();
            let changed = state.titles.get(app_id).map(|(p, _)| *p) != Some(probe);
            if !state.titles.contains_key(app_id)
                && state.titles.len() >= MAX_APPS
                && let Some(oldest) = state
                    .titles
                    .iter()
                    .min_by_key(|(_, (_, at))| *at)
                    .map(|(k, _)| k.clone())
            {
                state.titles.remove(&oldest);
            }
            state.titles.insert(app_id.to_owned(), (probe, now));
            changed
        };
        if changed {
            self.append(
                now,
                &format!("title app={} {}", sanitize(app_id), probe.describe()),
            );
        }
    }

    /// Free-form adapter note keyed by an app id; `what` must be a static string.
    pub fn record_note(&self, app_id: &str, what: &'static str, now: UtcMs) {
        self.append(now, &format!("note app={} {what}", sanitize(app_id)));
    }

    /// Logs power, lock, idle and permission signals; focus signals (titles) are skipped.
    pub fn record_signal(&self, source: &'static str, signal: &SystemSignal, now: UtcMs) {
        if let Some(text) = signal_text(signal) {
            self.append(now, &format!("signal source={source} {text}"));
        }
    }

    pub fn snapshot(&self) -> DiagnosticsSnapshot {
        let state = self.state();
        let mut title_reads: Vec<TitleReadStatus> = state
            .titles
            .iter()
            .map(|(app_id, (probe, at))| TitleReadStatus {
                app_id: app_id.clone(),
                probe: *probe,
                at: *at,
            })
            .collect();
        title_reads.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| a.app_id.cmp(&b.app_id)));
        DiagnosticsSnapshot {
            trusted: state.trusted,
            title_reads,
        }
    }

    /// Text for "Copy diagnostics": `header` lines, the current status and both log files.
    pub fn report(&self, header: &[String]) -> String {
        let snapshot = self.snapshot();
        let mut out = String::from("Kaiflow diagnostics\n");
        for line in header {
            out.push_str(line);
            out.push('\n');
        }
        let trusted = match snapshot.trusted {
            Some(true) => "yes",
            Some(false) => "no",
            None => "unknown",
        };
        out.push_str(&format!("accessibility trusted: {trusted}\n"));
        out.push_str("last title read per app:\n");
        if snapshot.title_reads.is_empty() {
            out.push_str("  (none yet)\n");
        }
        for read in &snapshot.title_reads {
            out.push_str(&format!(
                "  {} {} at {}\n",
                sanitize(&read.app_id),
                read.probe.describe(),
                format_utc(read.at)
            ));
        }
        if let Some(path) = &self.0.path {
            let _guard = self.0.file.lock().unwrap_or_else(PoisonError::into_inner);
            for file in [rotated(path), path.clone()] {
                if let Ok(text) = fs::read_to_string(&file) {
                    let name = file
                        .file_name()
                        .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
                    out.push_str(&format!("--- {name} ---\n"));
                    out.push_str(&text);
                }
            }
        }
        out
    }

    /// Appends one line; I/O errors are ignored (diagnostics must never break tracking).
    fn append(&self, now: UtcMs, text: &str) {
        let Some(path) = &self.0.path else {
            return;
        };
        let line = format!("{} {text}\n", format_utc(now));
        let _guard = self.0.file.lock().unwrap_or_else(PoisonError::into_inner);
        let size = fs::metadata(path).map_or(0, |m| m.len());
        if size + line.len() as u64 > self.0.max_bytes {
            let _ = fs::rename(path, rotated(path));
        }
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = file.write_all(line.as_bytes());
        }
    }

    /// A sender that logs every signal (as `source`) and forwards it to `out`. The forwarding
    /// thread ends when every clone of the returned sender is dropped. Keeps file I/O off the
    /// thread that observes the OS (the macOS main thread).
    pub fn forwarding(
        &self,
        source: &'static str,
        out: Sender<SystemSignal>,
        clock: impl Fn() -> UtcMs + Send + 'static,
    ) -> Sender<SystemSignal> {
        let (tx, rx) = unbounded::<SystemSignal>();
        let fallback = out.clone();
        let diagnostics = self.clone();
        let spawned = std::thread::Builder::new()
            .name("diagnostics".into())
            .spawn(move || {
                for signal in rx {
                    diagnostics.record_signal(source, &signal, clock());
                    if out.send(signal).is_err() {
                        break;
                    }
                }
            });
        match spawned {
            Ok(_) => tx,
            // No thread: signals go straight to the engine, unlogged.
            Err(_) => fallback,
        }
    }
}

/// Signals worth a log line. Focus snapshots are never logged (they carry titles).
pub fn signal_text(signal: &SystemSignal) -> Option<String> {
    Some(match signal {
        SystemSignal::Focus(_) => return None,
        SystemSignal::IdleDetected { since } => format!("idle since={}", format_utc(*since)),
        SystemSignal::ActivityResumed => "activity_resumed".into(),
        SystemSignal::WillSleep => "will_sleep".into(),
        SystemSignal::DidWake => "did_wake".into(),
        SystemSignal::ScreenLocked => "screen_locked".into(),
        SystemSignal::ScreenUnlocked => "screen_unlocked".into(),
        SystemSignal::PowerOff => "power_off".into(),
        SystemSignal::PermissionChanged(PermissionState::Granted) => "permission=granted".into(),
        SystemSignal::PermissionChanged(PermissionState::Denied) => "permission=denied".into(),
    })
}

fn rotated(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(".1");
    PathBuf::from(name)
}

/// Application ids are not secret, but keep a log line one line and printable.
fn sanitize(app_id: &str) -> String {
    app_id
        .chars()
        .take(128)
        .map(|c| if c.is_control() || c == ' ' { '_' } else { c })
        .collect()
}

/// `2026-10-22T19:22:18.123Z` without a date crate (days-from-civil inverse, H. Hinnant).
pub fn format_utc(at: UtcMs) -> String {
    let ms = at.0.rem_euclid(1000);
    let secs = at.0.div_euclid(1000);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}T{h:02}:{m:02}:{s:02}.{ms:03}Z")
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::FocusSnapshot;

    fn read(dir: &Path) -> String {
        fs::read_to_string(dir.join(DIAGNOSTICS_FILE)).unwrap_or_default()
    }

    #[test]
    fn timestamps_are_iso_8601_utc() {
        assert_eq!(format_utc(UtcMs(0)), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            format_utc(UtcMs(1_792_714_938_123)),
            "2026-10-23T00:22:18.123Z"
        );
        assert_eq!(
            format_utc(UtcMs(951_782_400_000)),
            "2000-02-29T00:00:00.000Z"
        );
        assert_eq!(format_utc(UtcMs(-1)), "1969-12-31T23:59:59.999Z");
    }

    #[test]
    fn trust_is_logged_only_when_it_changes() {
        let dir = tempfile::tempdir().unwrap();
        let d = Diagnostics::in_dir(dir.path());
        d.record_trust(false, UtcMs(0));
        d.record_trust(false, UtcMs(2_000));
        d.record_trust(true, UtcMs(4_000));
        let log = read(dir.path());
        assert_eq!(log.lines().count(), 2, "{log}");
        assert!(log.contains("accessibility trusted=no"));
        assert!(log.contains("accessibility trusted=yes"));
        assert_eq!(d.snapshot().trusted, Some(true));
    }

    #[test]
    fn title_reads_are_logged_per_app_on_change_and_never_contain_a_title() {
        let dir = tempfile::tempdir().unwrap();
        let d = Diagnostics::in_dir(dir.path());
        let failed = TitleProbe::Failed {
            step: "AXFocusedWindow",
            code: -25204,
            label: "kAXErrorCannotComplete",
        };
        d.record_title("com.a", failed, UtcMs(0));
        d.record_title("com.a", failed, UtcMs(2_000));
        d.record_title(
            "com.a",
            TitleProbe::Read {
                via: "AXMainWindow",
            },
            UtcMs(4_000),
        );
        d.record_title("com.b", TitleProbe::NotTrusted, UtcMs(6_000));
        let log = read(dir.path());
        assert_eq!(log.lines().count(), 3, "{log}");
        assert!(log.contains("app=com.a error -25204 (kAXErrorCannotComplete) at AXFocusedWindow"));
        assert!(log.contains("app=com.a ok via AXMainWindow"));
        let snapshot = d.snapshot();
        assert_eq!(snapshot.title_reads[0].app_id, "com.b");
        assert_eq!(
            snapshot.title_reads[1].probe,
            TitleProbe::Read {
                via: "AXMainWindow"
            }
        );
    }

    #[test]
    fn focus_signals_are_never_logged() {
        let dir = tempfile::tempdir().unwrap();
        let d = Diagnostics::in_dir(dir.path());
        let focus = FocusSnapshot {
            app_id: "com.a".into(),
            app_name: "A".into(),
            pid: 1,
            window_title: Some("PRIVATE".into()),
        };
        d.record_signal("os", &SystemSignal::Focus(Some(focus)), UtcMs(0));
        d.record_signal("os", &SystemSignal::ScreenLocked, UtcMs(1_000));
        d.record_signal("sampler", &SystemSignal::ScreenUnlocked, UtcMs(2_000));
        let log = read(dir.path());
        assert!(!log.contains("PRIVATE"));
        assert!(log.contains("signal source=os screen_locked"));
        assert!(log.contains("signal source=sampler screen_unlocked"));
        assert_eq!(log.lines().count(), 2);
    }

    #[test]
    fn the_log_rotates_and_stays_bounded() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(DIAGNOSTICS_FILE);
        let d = Diagnostics::with_file(path.clone(), 1_000);
        for i in 0..200 {
            d.record_note("com.example.app", "ax_manual_accessibility_set", UtcMs(i));
        }
        let current = fs::metadata(&path).unwrap().len();
        let old = fs::metadata(rotated(&path)).unwrap().len();
        assert!(current <= 1_000 && old <= 1_000, "{current} {old}");
        let report = d.report(&["version: test".into()]);
        assert!(report.starts_with("Kaiflow diagnostics\nversion: test\n"));
        assert!(report.contains("--- diagnostics.log.1 ---"));
        assert!(report.contains("--- diagnostics.log ---"));
    }

    #[test]
    fn the_app_map_is_bounded() {
        let d = Diagnostics::in_memory();
        for i in 0..(MAX_APPS as i64 + 10) {
            d.record_title(&format!("app{i}"), TitleProbe::NotTrusted, UtcMs(i));
        }
        let snapshot = d.snapshot();
        assert_eq!(snapshot.title_reads.len(), MAX_APPS);
        assert_eq!(
            snapshot.title_reads[0].app_id,
            format!("app{}", MAX_APPS + 9)
        );
    }

    #[test]
    fn app_ids_are_kept_on_one_line() {
        assert_eq!(sanitize("a b\nc"), "a_b_c");
    }

    #[test]
    fn the_forwarder_logs_and_passes_signals_through() {
        let dir = tempfile::tempdir().unwrap();
        let d = Diagnostics::in_dir(dir.path());
        let (out, rx) = unbounded();
        let tx = d.forwarding("os", out, || UtcMs(0));
        tx.send(SystemSignal::WillSleep).unwrap();
        assert_eq!(
            rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap(),
            SystemSignal::WillSleep
        );
        drop(tx);
        assert!(read(dir.path()).contains("signal source=os will_sleep"));
    }
}
