//! JSON export, automatic daily backup and restore (spec: data-export-backup).
//!
//! Three flows share one document ([`crate::backup::Document`]) and one atomic file writer:
//! an export of a range the user saves wherever they like, the gzip backup written once per
//! local day with a 7 daily + 4 weekly retention, and a restore that previews a file first and
//! only replaces the data after a second, token-confirmed step.

use std::ffi::OsString;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use domain::UtcMs;
use domain::backup_retention::{civil_from_days, days_from_civil, select_to_delete};

use crate::backup::{DEVICE_SETTINGS, Document, DocumentError, Kind, MAX_DOCUMENT_BYTES, Summary};
use crate::commands::CONFIRM_TOKEN_TTL_MS;
use crate::ports::{BackupStore, Calendar, FileSink, PortError, SettingsRepository};
use crate::queries::Range;
use crate::settings_blobs::{BackupSettings, KEY_BACKUP, read_blob, write_blob};

const BACKUP_PREFIX: &str = "kaiflow-backup-";
/// Prefix of the daily backups written before the rename to Kaiflow. They are still counted,
/// kept or pruned by the retention policy like the new ones.
const LEGACY_BACKUP_PREFIX: &str = "timetrack-backup-";
const BACKUP_SUFFIX: &str = ".json.gz";
/// Weeks start on Monday until the calendar settings arrive with goals.
const WEEK_START: u8 = 0;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DataError {
    /// Bad input (inverted range, unreadable or unsupported file, relative folder...).
    Invalid(String),
    /// Restore without a valid, unexpired token.
    ConfirmationRequired,
    Storage(PortError),
}

impl fmt::Display for DataError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid(m) => f.write_str(m),
            Self::ConfirmationRequired => f.write_str("confirmation required"),
            Self::Storage(e) => e.fmt(f),
        }
    }
}

impl std::error::Error for DataError {}

impl From<PortError> for DataError {
    fn from(e: PortError) -> Self {
        Self::Storage(e)
    }
}

impl From<DocumentError> for DataError {
    fn from(e: DocumentError) -> Self {
        Self::Invalid(e.to_string())
    }
}

/// What the Data settings show.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupStatus {
    pub enabled: bool,
    /// The folder the user picked; `None` while the default one is used.
    pub custom_dir: Option<String>,
    /// The folder backups go to right now.
    pub dir: String,
    pub last_backup_at: Option<UtcMs>,
    pub last_error: Option<String>,
    /// Backups currently stored in `dir`.
    pub stored: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupReport {
    pub path: PathBuf,
    pub bytes: usize,
    /// Older backups removed by the retention policy.
    pub removed: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScheduledBackup {
    /// Disabled, or today's backup already exists.
    Skipped,
    Done(BackupReport),
    /// `first` is true only for the first failure of a streak: that is when to tell the user.
    Failed {
        message: String,
        first: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RestorePreview {
    /// Single-use token the apply step must send back within a minute.
    pub token: String,
    pub summary: Summary,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RestoreReport {
    /// Complete copy of the data as it was before the restore.
    pub safety_copy: PathBuf,
}

struct PendingRestore {
    token: String,
    document: Document,
    issued_at: UtcMs,
}

pub struct DataService {
    store: Arc<dyn BackupStore>,
    files: Arc<dyn FileSink>,
    settings: Arc<dyn SettingsRepository>,
    calendar: Arc<dyn Calendar>,
    default_dir: PathBuf,
    /// The database path; safety copies are written next to it as `<name>.pre-restore-<ts>`.
    safety_base: PathBuf,
    app_version: String,
    pending: Mutex<Option<PendingRestore>>,
    counter: AtomicU64,
}

impl DataService {
    pub fn new(
        store: Arc<dyn BackupStore>,
        files: Arc<dyn FileSink>,
        settings: Arc<dyn SettingsRepository>,
        calendar: Arc<dyn Calendar>,
        default_dir: PathBuf,
        safety_base: PathBuf,
        app_version: &str,
    ) -> Self {
        Self {
            store,
            files,
            settings,
            calendar,
            default_dir,
            safety_base,
            app_version: app_version.to_owned(),
            pending: Mutex::new(None),
            counter: AtomicU64::new(0),
        }
    }

    // ---- export ----

    /// The JSON text of an export of `range`. Titles are left out when the user does not
    /// store them. `timezone` is a readable label such as `UTC+02:00`.
    pub fn export_json(
        &self,
        range: Range,
        now: UtcMs,
        timezone: &str,
    ) -> Result<Vec<u8>, DataError> {
        if range.from >= range.to {
            return Err(DataError::Invalid(
                "range start must be before its end".into(),
            ));
        }
        let data = self.snapshot(Some((range.from, range.to)))?;
        let document = Document::new(
            Kind::Export,
            &self.app_version,
            now,
            timezone,
            Some((range.from, range.to)),
            data,
        );
        Ok(document.to_json())
    }

    /// Writes an export to `path` atomically.
    pub fn export_to(
        &self,
        path: &Path,
        range: Range,
        now: UtcMs,
        timezone: &str,
    ) -> Result<(), DataError> {
        let bytes = self.export_json(range, now, timezone)?;
        Ok(self.files.write_atomic(path, &bytes)?)
    }

    fn snapshot(
        &self,
        range: Option<(UtcMs, UtcMs)>,
    ) -> Result<crate::backup::BackupData, DataError> {
        let mut data = self.store.snapshot(range)?;
        data.settings
            .retain(|s| !DEVICE_SETTINGS.contains(&s.key.as_str()));
        if !self.titles_stored()? {
            data.strip_titles();
        }
        Ok(data)
    }

    fn titles_stored(&self) -> Result<bool, DataError> {
        Ok(self.settings.get("store_titles")?.as_deref() != Some("false"))
    }

    // ---- backup ----

    fn backup_settings(&self) -> Result<BackupSettings, DataError> {
        Ok(read_blob(self.settings.as_ref(), KEY_BACKUP)?)
    }

    fn save_backup_settings(&self, blob: &BackupSettings) -> Result<(), DataError> {
        Ok(write_blob(self.settings.as_ref(), KEY_BACKUP, blob)?)
    }

    fn backup_dir(&self, blob: &BackupSettings) -> PathBuf {
        blob.dir
            .as_deref()
            .map_or_else(|| self.default_dir.clone(), PathBuf::from)
    }

    pub fn backup_status(&self) -> Result<BackupStatus, DataError> {
        let blob = self.backup_settings()?;
        let dir = self.backup_dir(&blob);
        let stored = self
            .files
            .list(&dir)
            .map(|names| {
                names
                    .iter()
                    .filter(|n| parse_backup_day(n).is_some())
                    .count()
            })
            .unwrap_or(0);
        Ok(BackupStatus {
            enabled: blob.enabled,
            custom_dir: blob.dir.clone(),
            dir: dir.display().to_string(),
            last_backup_at: blob.last_backup_at.map(UtcMs),
            last_error: blob.last_error.clone(),
            stored,
        })
    }

    pub fn set_backup_enabled(&self, enabled: bool) -> Result<(), DataError> {
        let mut blob = self.backup_settings()?;
        blob.enabled = enabled;
        self.save_backup_settings(&blob)
    }

    /// `None` goes back to the default folder. A custom folder must be an absolute path.
    pub fn set_backup_dir(&self, dir: Option<&str>) -> Result<(), DataError> {
        let mut blob = self.backup_settings()?;
        blob.dir = match dir.map(str::trim).filter(|d| !d.is_empty()) {
            None => None,
            Some(d) if Path::new(d).is_absolute() => Some(d.to_owned()),
            Some(_) => {
                return Err(DataError::Invalid(
                    "the backup folder must be an absolute path".into(),
                ));
            }
        };
        // A new folder deserves a fresh attempt: forget the previous failure.
        blob.last_error = None;
        blob.failure_notified = false;
        self.save_backup_settings(&blob)
    }

    /// Writes today's backup (replacing an earlier one of the same day) and applies the
    /// retention policy. Records the outcome in the backup settings either way.
    pub fn backup_now(&self, now: UtcMs, timezone: &str) -> Result<BackupReport, DataError> {
        self.perform_backup(now, timezone).inspect_err(|error| {
            self.record_failure(&error.to_string());
        })
    }

    fn perform_backup(&self, now: UtcMs, timezone: &str) -> Result<BackupReport, DataError> {
        let report = self.write_backup(now, timezone)?;
        let mut blob = self.backup_settings()?;
        blob.last_backup_at = Some(now.0);
        blob.last_error = None;
        blob.failure_notified = false;
        self.save_backup_settings(&blob)?;
        Ok(report)
    }

    /// The hourly check: backs up when enabled and no backup was made yet on this local day.
    pub fn run_scheduled_backup(
        &self,
        now: UtcMs,
        timezone: &str,
    ) -> Result<ScheduledBackup, DataError> {
        let blob = self.backup_settings()?;
        let today = self.calendar.local_day(now);
        let done_today = blob
            .last_backup_at
            .is_some_and(|at| self.calendar.local_day(UtcMs(at)) >= today);
        if !blob.enabled || done_today {
            return Ok(ScheduledBackup::Skipped);
        }
        match self.perform_backup(now, timezone) {
            Ok(report) => Ok(ScheduledBackup::Done(report)),
            Err(error) => {
                let first = self.record_failure(&error.to_string());
                Ok(ScheduledBackup::Failed {
                    message: error.to_string(),
                    first,
                })
            }
        }
    }

    /// Stores the failure; returns whether it is the first of its streak.
    fn record_failure(&self, message: &str) -> bool {
        let Ok(mut blob) = self.backup_settings() else {
            return true;
        };
        let first = !blob.failure_notified;
        blob.last_error = Some(message.to_owned());
        blob.failure_notified = true;
        let _ = self.save_backup_settings(&blob);
        first
    }

    fn write_backup(&self, now: UtcMs, timezone: &str) -> Result<BackupReport, DataError> {
        let blob = self.backup_settings()?;
        let dir = self.backup_dir(&blob);
        if !dir.is_absolute() {
            return Err(DataError::Invalid(
                "the backup folder must be an absolute path".into(),
            ));
        }
        let data = self.snapshot(None)?;
        let bytes =
            Document::new(Kind::Backup, &self.app_version, now, timezone, None, data).to_gzip();
        let today = self.calendar.local_day(now);
        let path = dir.join(backup_file_name(today));
        self.files.write_atomic(&path, &bytes).map_err(|e| {
            DataError::Storage(PortError(format!(
                "could not write the backup to {}: {e}",
                dir.display()
            )))
        })?;
        Ok(BackupReport {
            path,
            bytes: bytes.len(),
            removed: self.apply_retention(&dir),
        })
    }

    /// Deletes the backups the policy no longer keeps; only files named like ours are touched.
    fn apply_retention(&self, dir: &Path) -> usize {
        let Ok(names) = self.files.list(dir) else {
            return 0;
        };
        let backups: Vec<(i64, &String)> = names
            .iter()
            .filter_map(|n| parse_backup_day(n).map(|day| (day, n)))
            .collect();
        let days: Vec<i64> = backups.iter().map(|(day, _)| *day).collect();
        let doomed = select_to_delete(&days, WEEK_START);
        // A day may have both a legacy and a current file: both go when the day goes.
        backups
            .into_iter()
            .filter(|(day, _)| doomed.contains(day))
            .filter(|(_, name)| self.files.delete(&dir.join(name)).is_ok())
            .count()
    }

    // ---- restore ----

    /// Reads a backup or export file and keeps it in memory behind a token. Nothing is
    /// modified yet.
    pub fn restore_prepare_file(
        &self,
        path: &Path,
        now: UtcMs,
    ) -> Result<RestorePreview, DataError> {
        let bytes = self.files.read(path, MAX_DOCUMENT_BYTES)?;
        self.restore_prepare(&bytes, now)
    }

    pub fn restore_prepare(&self, bytes: &[u8], now: UtcMs) -> Result<RestorePreview, DataError> {
        let document = Document::parse(bytes)?;
        let summary = document.summary();
        let n = self.counter.fetch_add(1, Ordering::Relaxed);
        let token = format!("{:x}-r{n:x}", now.0);
        *self.lock_pending() = Some(PendingRestore {
            token: token.clone(),
            document,
            issued_at: now,
        });
        Ok(RestorePreview { token, summary })
    }

    /// Second step: with the right token, copies the current database aside and replaces all
    /// data in one transaction. The caller stops tracking before and reloads views after.
    pub fn restore_apply(&self, token: &str, now: UtcMs) -> Result<RestoreReport, DataError> {
        let document = {
            let mut slot = self.lock_pending();
            match slot.take() {
                Some(p) if p.token == token => {
                    if !(0..=CONFIRM_TOKEN_TTL_MS).contains(&now.since(p.issued_at)) {
                        return Err(DataError::ConfirmationRequired);
                    }
                    p.document
                }
                other => {
                    // A wrong token must not cancel the preview that is still valid.
                    *slot = other;
                    return Err(DataError::ConfirmationRequired);
                }
            }
        };
        let safety_copy = self.safety_path(now);
        self.store.safety_copy(&safety_copy)?;
        self.store.replace_all(&document.data)?;
        Ok(RestoreReport { safety_copy })
    }

    fn safety_path(&self, now: UtcMs) -> PathBuf {
        let mut name: OsString = self
            .safety_base
            .file_name()
            .map(ToOwned::to_owned)
            .unwrap_or_default();
        name.push(format!(".pre-restore-{}", now.0));
        self.safety_base.with_file_name(name)
    }

    fn lock_pending(&self) -> std::sync::MutexGuard<'_, Option<PendingRestore>> {
        self.pending.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// `kaiflow-backup-YYYY-MM-DD.json.gz` for a local day number.
pub fn backup_file_name(day: i64) -> String {
    let (year, month, date) = civil_from_days(day);
    format!("{BACKUP_PREFIX}{year:04}-{month:02}-{date:02}{BACKUP_SUFFIX}")
}

/// The local day a backup file name stands for (current or legacy prefix); `None` for any
/// other file.
pub fn parse_backup_day(name: &str) -> Option<i64> {
    let date = name
        .strip_prefix(BACKUP_PREFIX)
        .or_else(|| name.strip_prefix(LEGACY_BACKUP_PREFIX))?
        .strip_suffix(BACKUP_SUFFIX)?;
    let mut parts = date.split('-');
    let year: i64 = parts.next()?.parse().ok()?;
    let month: u32 = parts.next()?.parse().ok()?;
    let day: u32 = parts.next()?.parse().ok()?;
    if parts.next().is_some() || date.len() != 10 {
        return None;
    }
    days_from_civil(year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backup::{ActivityRecord, SegmentRecord, SettingRecord};
    use crate::fakes::{FakeBackupStore, FakeFiles, FakeSettings, FixedCalendar};

    const DAY: i64 = 86_400_000;
    const DIR: &str = "/backups";

    struct Rig {
        service: DataService,
        store: FakeBackupStore,
        files: FakeFiles,
        settings: FakeSettings,
    }

    fn segment(id: i64, start: i64, end: i64, title: &str) -> SegmentRecord {
        SegmentRecord {
            id,
            started_at: start,
            ended_at: Some(end),
            heartbeat_at: end,
            app_id: Some("app".into()),
            app_name: Some("App".into()),
            window_title: Some(title.into()),
            end_reason: Some("focus_change".into()),
            source: "tracked".into(),
            activity_id: None,
        }
    }

    fn data() -> crate::backup::BackupData {
        crate::backup::BackupData {
            activities: vec![ActivityRecord {
                id: 1,
                name: "Unassigned".into(),
                color: "#999".into(),
                sort_order: 0,
                productivity: "neutral".into(),
                preset_key: None,
            }],
            segments: vec![
                segment(1, 0, 1_000, "secret plan"),
                segment(2, 5 * DAY, 5 * DAY + 10, "later"),
            ],
            settings: vec![
                SettingRecord {
                    key: "theme".into(),
                    value: "\"dark\"".into(),
                },
                SettingRecord {
                    key: "autostart".into(),
                    value: "true".into(),
                },
                SettingRecord {
                    key: "backup".into(),
                    value: "{\"dir\":\"/x\"}".into(),
                },
            ],
            ..Default::default()
        }
    }

    fn rig() -> Rig {
        let store = FakeBackupStore::with_data(data());
        let files = FakeFiles::default();
        let settings = FakeSettings::default();
        let service = DataService::new(
            Arc::new(store.clone()),
            Arc::new(files.clone()),
            Arc::new(settings.clone()),
            Arc::new(FixedCalendar::fixed(0)),
            DIR.into(),
            "/data/kaiflow.db".into(),
            "9.9.9",
        );
        Rig {
            service,
            store,
            files,
            settings,
        }
    }

    fn range(from: i64, to: i64) -> Range {
        Range {
            from: UtcMs(from),
            to: UtcMs(to),
        }
    }

    fn backup_names(files: &FakeFiles) -> Vec<String> {
        let mut names = files.names_in(Path::new(DIR));
        names.sort();
        names
    }

    #[test]
    fn export_covers_only_the_range_and_never_device_settings() {
        let rig = rig();
        let bytes = rig
            .service
            .export_json(range(0, DAY), UtcMs(10), "UTC+00:00")
            .unwrap();
        let doc = Document::parse(&bytes).unwrap();
        assert_eq!(doc.kind, Kind::Export);
        assert_eq!(doc.app_version, "9.9.9");
        assert_eq!(doc.data.segments.len(), 1);
        let keys: Vec<&str> = doc.data.settings.iter().map(|s| s.key.as_str()).collect();
        assert_eq!(keys, ["theme"]);
        assert!(
            rig.service
                .export_json(range(5, 5), UtcMs(0), "UTC")
                .is_err()
        );
    }

    #[test]
    fn titles_are_left_out_when_the_user_does_not_store_them() {
        let rig = rig();
        rig.settings.set("store_titles", "false").unwrap();
        let doc = Document::parse(
            &rig.service
                .export_json(range(0, 9 * DAY), UtcMs(0), "UTC")
                .unwrap(),
        )
        .unwrap();
        assert!(doc.data.segments.iter().all(|s| s.window_title.is_none()));
        rig.settings.set("store_titles", "true").unwrap();
        let doc = Document::parse(
            &rig.service
                .export_json(range(0, 9 * DAY), UtcMs(0), "UTC")
                .unwrap(),
        )
        .unwrap();
        assert!(doc.data.segments.iter().any(|s| s.window_title.is_some()));
    }

    #[test]
    fn export_to_writes_atomically_through_the_sink() {
        let rig = rig();
        let path = Path::new("/out/export.json");
        rig.service
            .export_to(path, range(0, DAY), UtcMs(0), "UTC")
            .unwrap();
        assert!(Document::parse(&rig.files.get(path).unwrap()).is_ok());

        rig.files.fail_writes_with("disk full");
        let err = rig
            .service
            .export_to(Path::new("/out/two.json"), range(0, DAY), UtcMs(0), "UTC");
        assert!(matches!(err, Err(DataError::Storage(_))));
        assert!(rig.files.get(Path::new("/out/two.json")).is_none());
    }

    #[test]
    fn backup_writes_a_named_gzip_file_and_records_the_time() {
        let rig = rig();
        let now = UtcMs(19_782 * DAY + 3_600_000);
        let report = rig.service.backup_now(now, "UTC+00:00").unwrap();
        assert_eq!(
            report.path,
            Path::new(DIR).join("kaiflow-backup-2024-02-29.json.gz")
        );
        let doc = Document::parse(&rig.files.get(&report.path).unwrap()).unwrap();
        assert_eq!(doc.kind, Kind::Backup);
        assert!(doc.range.is_none());
        let status = rig.service.backup_status().unwrap();
        assert_eq!(status.last_backup_at, Some(now));
        assert_eq!(status.stored, 1);
        assert!(status.enabled && status.custom_dir.is_none());
    }

    #[test]
    fn ten_daily_backups_end_up_as_the_policy_keeps_them() {
        let rig = rig();
        for day in 100..110 {
            rig.files
                .put(&Path::new(DIR).join(backup_file_name(day)), b"x");
        }
        rig.files.put(&Path::new(DIR).join("notes.txt"), b"keep me");
        let report = rig.service.backup_now(UtcMs(110 * DAY), "UTC").unwrap();
        // 101..=110 are the ten newest days: seven daily plus the older ones per week.
        let kept: Vec<i64> = backup_names(&rig.files)
            .iter()
            .filter_map(|n| parse_backup_day(n))
            .collect();
        assert!(kept.len() <= 11, "{kept:?}");
        assert!(kept.contains(&110) && kept.contains(&104));
        assert!(report.removed >= 1);
        assert!(
            backup_names(&rig.files).contains(&"notes.txt".to_owned()),
            "foreign files stay"
        );
    }

    #[test]
    fn the_scheduled_run_backs_up_once_per_local_day_and_respects_the_switch() {
        let rig = rig();
        let morning = UtcMs(50 * DAY + 8 * 3_600_000);
        assert!(matches!(
            rig.service.run_scheduled_backup(morning, "UTC").unwrap(),
            ScheduledBackup::Done(_)
        ));
        assert_eq!(
            rig.service
                .run_scheduled_backup(UtcMs(morning.0 + 3_600_000), "UTC")
                .unwrap(),
            ScheduledBackup::Skipped
        );
        // First check after local midnight.
        let next = UtcMs(51 * DAY + 60_000);
        assert!(matches!(
            rig.service.run_scheduled_backup(next, "UTC").unwrap(),
            ScheduledBackup::Done(_)
        ));

        rig.service.set_backup_enabled(false).unwrap();
        assert_eq!(
            rig.service
                .run_scheduled_backup(UtcMs(52 * DAY), "UTC")
                .unwrap(),
            ScheduledBackup::Skipped
        );
        assert_eq!(backup_names(&rig.files).len(), 2);
    }

    #[test]
    fn local_midnight_follows_the_calendar_not_utc() {
        let store = FakeBackupStore::with_data(data());
        let files = FakeFiles::default();
        let settings = FakeSettings::default();
        // UTC-5: local midnight is 05:00 UTC.
        let service = DataService::new(
            Arc::new(store),
            Arc::new(files),
            Arc::new(settings),
            Arc::new(FixedCalendar::fixed(-5 * 3_600_000)),
            DIR.into(),
            "/data/db".into(),
            "1",
        );
        let evening = UtcMs(50 * DAY + 3 * 3_600_000); // still local day 49
        assert!(matches!(
            service.run_scheduled_backup(evening, "UTC-05:00").unwrap(),
            ScheduledBackup::Done(_)
        ));
        // 04:59 UTC is still the same local day; 05:01 UTC is the next one.
        assert_eq!(
            service
                .run_scheduled_backup(UtcMs(50 * DAY + 4 * 3_600_000 + 59 * 60_000), "x")
                .unwrap(),
            ScheduledBackup::Skipped
        );
        assert!(matches!(
            service
                .run_scheduled_backup(UtcMs(50 * DAY + 5 * 3_600_000 + 60_000), "x")
                .unwrap(),
            ScheduledBackup::Done(_)
        ));
    }

    #[test]
    fn a_failing_folder_reports_once_keeps_old_backups_and_recovers() {
        let rig = rig();
        let old = Path::new(DIR).join(backup_file_name(10));
        rig.files.put(&old, b"previous");
        rig.files.fail_writes_with("permission denied");

        let first = rig
            .service
            .run_scheduled_backup(UtcMs(50 * DAY), "UTC")
            .unwrap();
        assert!(matches!(first, ScheduledBackup::Failed { first: true, .. }));
        let second = rig
            .service
            .run_scheduled_backup(UtcMs(50 * DAY + 3_600_000), "UTC")
            .unwrap();
        assert!(
            matches!(second, ScheduledBackup::Failed { first: false, .. }),
            "announced only once"
        );
        assert_eq!(rig.files.get(&old).unwrap(), b"previous");
        let status = rig.service.backup_status().unwrap();
        assert!(status.last_error.unwrap().contains("permission denied"));
        assert!(status.last_backup_at.is_none());

        rig.files.heal();
        assert!(matches!(
            rig.service
                .run_scheduled_backup(UtcMs(50 * DAY + 7_200_000), "UTC")
                .unwrap(),
            ScheduledBackup::Done(_)
        ));
        let status = rig.service.backup_status().unwrap();
        assert!(status.last_error.is_none());
        // A later streak is announced again.
        rig.files.fail_writes_with("gone");
        assert!(matches!(
            rig.service
                .run_scheduled_backup(UtcMs(51 * DAY), "UTC")
                .unwrap(),
            ScheduledBackup::Failed { first: true, .. }
        ));
    }

    #[test]
    fn the_backup_folder_must_be_absolute_and_can_be_reset() {
        let rig = rig();
        assert!(rig.service.set_backup_dir(Some("relative/dir")).is_err());
        rig.service.set_backup_dir(Some("/mnt/safe")).unwrap();
        let report = rig.service.backup_now(UtcMs(DAY), "UTC").unwrap();
        assert!(report.path.starts_with("/mnt/safe"));
        assert_eq!(
            rig.service.backup_status().unwrap().custom_dir.as_deref(),
            Some("/mnt/safe")
        );
        rig.service.set_backup_dir(None).unwrap();
        assert_eq!(rig.service.backup_status().unwrap().dir, DIR);
    }

    fn backup_bytes(rig: &Rig) -> Vec<u8> {
        let report = rig.service.backup_now(UtcMs(20 * DAY), "UTC").unwrap();
        rig.files.get(&report.path).unwrap()
    }

    #[test]
    fn restore_round_trip_makes_a_safety_copy_and_replaces_everything() {
        let rig = rig();
        let bytes = backup_bytes(&rig);
        // The live data changes after the backup.
        rig.store
            .replace_all(&crate::backup::BackupData::default())
            .unwrap();

        let preview = rig.service.restore_prepare(&bytes, UtcMs(100)).unwrap();
        assert_eq!(preview.summary.segments, 2);
        assert_eq!(preview.summary.kind, Kind::Backup);
        assert!(
            rig.store.data().segments.is_empty(),
            "preview must not touch data"
        );

        let report = rig
            .service
            .restore_apply(&preview.token, UtcMs(200))
            .unwrap();
        assert_eq!(rig.store.safety_copies(), vec![report.safety_copy.clone()]);
        assert_eq!(
            report.safety_copy,
            Path::new("/data/kaiflow.db.pre-restore-200")
        );
        assert_eq!(rig.store.data().segments.len(), 2);
        // Single use.
        assert_eq!(
            rig.service.restore_apply(&preview.token, UtcMs(201)),
            Err(DataError::ConfirmationRequired)
        );
    }

    #[test]
    fn restore_needs_the_matching_fresh_token() {
        let rig = rig();
        let bytes = backup_bytes(&rig);
        assert_eq!(
            rig.service.restore_apply("anything", UtcMs(0)),
            Err(DataError::ConfirmationRequired)
        );

        let preview = rig.service.restore_prepare(&bytes, UtcMs(1_000)).unwrap();
        assert_eq!(
            rig.service.restore_apply("wrong", UtcMs(1_001)),
            Err(DataError::ConfirmationRequired)
        );
        assert!(rig.store.safety_copies().is_empty());
        // The wrong attempt did not cancel the preview.
        let late = UtcMs(1_000 + CONFIRM_TOKEN_TTL_MS + 1);
        assert_eq!(
            rig.service.restore_apply(&preview.token, late),
            Err(DataError::ConfirmationRequired)
        );
        assert!(rig.store.safety_copies().is_empty());
    }

    #[test]
    fn invalid_files_never_reach_the_store() {
        let rig = rig();
        assert!(matches!(
            rig.service.restore_prepare(b"garbage", UtcMs(0)),
            Err(DataError::Invalid(_))
        ));
        let mut future: serde_json::Value =
            serde_json::from_slice(&backup_bytes_plain(&rig)).unwrap();
        future["schema_version"] = 7.into();
        let err = rig
            .service
            .restore_prepare(&serde_json::to_vec(&future).unwrap(), UtcMs(0));
        assert!(matches!(err, Err(DataError::Invalid(m)) if m.contains("version 7")));
        assert_eq!(
            rig.service.restore_apply("x", UtcMs(0)),
            Err(DataError::ConfirmationRequired)
        );
        assert_eq!(rig.store.data(), data());
    }

    fn backup_bytes_plain(rig: &Rig) -> Vec<u8> {
        rig.service
            .export_json(range(0, 9 * DAY), UtcMs(0), "UTC")
            .unwrap()
    }

    #[test]
    fn a_failed_replace_reports_the_error_after_the_safety_copy() {
        let rig = rig();
        let bytes = backup_bytes(&rig);
        let preview = rig.service.restore_prepare(&bytes, UtcMs(0)).unwrap();
        rig.store.fail_replace();
        assert!(matches!(
            rig.service.restore_apply(&preview.token, UtcMs(1)),
            Err(DataError::Storage(_))
        ));
        assert_eq!(rig.store.data(), data());
    }

    #[test]
    fn restore_prepare_file_reads_through_the_sink() {
        let rig = rig();
        let path = Path::new("/picked/backup.json.gz");
        rig.files.put(path, &backup_bytes(&rig));
        assert_eq!(
            rig.service
                .restore_prepare_file(path, UtcMs(0))
                .unwrap()
                .summary
                .activities,
            1
        );
        assert!(
            rig.service
                .restore_prepare_file(Path::new("/missing"), UtcMs(0))
                .is_err()
        );
    }

    #[test]
    fn backup_file_names_round_trip() {
        let name = backup_file_name(19_782);
        assert_eq!(name, "kaiflow-backup-2024-02-29.json.gz");
        assert_eq!(parse_backup_day(&name), Some(19_782));
        for bad in [
            "kaiflow-backup-2024-2-29.json.gz",
            "backup.json.gz",
            "kaiflow-backup-2024-02-30.json.gz",
            "kaiflow-backup-2024-02-29.json",
            "other-backup-2024-02-29.json.gz",
        ] {
            assert_eq!(parse_backup_day(bad), None, "{bad}");
        }
        assert_eq!(
            parse_backup_day("timetrack-backup-2024-02-29.json.gz"),
            Some(19_782),
            "backups written before the rename are still recognized"
        );
    }

    #[test]
    fn retention_counts_and_prunes_backups_from_before_the_rename() {
        let rig = rig();
        for day in 100..105 {
            rig.files.put(
                &Path::new(DIR).join(format!(
                    "{LEGACY_BACKUP_PREFIX}{}",
                    &backup_file_name(day)[BACKUP_PREFIX.len()..]
                )),
                b"x",
            );
        }
        for day in 105..110 {
            rig.files
                .put(&Path::new(DIR).join(backup_file_name(day)), b"x");
        }
        assert_eq!(rig.service.backup_status().unwrap().stored, 10);
        let report = rig.service.backup_now(UtcMs(110 * DAY), "UTC").unwrap();
        assert!(report.removed >= 1);
        let remaining = backup_names(&rig.files);
        let days: Vec<i64> = remaining
            .iter()
            .filter_map(|n| parse_backup_day(n))
            .collect();
        assert!(days.contains(&110) && days.contains(&104), "{remaining:?}");
        let legacy_left = remaining
            .iter()
            .filter(|n| n.starts_with(LEGACY_BACKUP_PREFIX))
            .count();
        assert_eq!(
            legacy_left + report.removed,
            5,
            "pruned files are legacy ones: {remaining:?}"
        );
    }

    #[test]
    fn exports_written_before_the_rename_still_restore() {
        let rig = rig();
        let mut value: serde_json::Value =
            serde_json::from_slice(&backup_bytes_plain(&rig)).unwrap();
        value["format"] = "timetrack".into();
        let legacy = serde_json::to_vec(&value).unwrap();
        rig.store
            .replace_all(&crate::backup::BackupData::default())
            .unwrap();

        let preview = rig.service.restore_prepare(&legacy, UtcMs(100)).unwrap();
        rig.service
            .restore_apply(&preview.token, UtcMs(200))
            .unwrap();
        assert_eq!(rig.store.data().segments.len(), 2);
    }
}
