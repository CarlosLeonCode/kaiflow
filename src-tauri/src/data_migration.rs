//! Carries the data of the app's former identity (Time Track Copilot) over to Kaiflow.
//!
//! The bundle identifier names the app data directory, so renaming it would otherwise start
//! everyone with an empty database. Before SQLite is opened, [`migrate_legacy_data`] copies
//! the old directory (database, WAL/SHM, migration and restore safety copies, backups...)
//! into the new one when the new one has no database yet. The old directory is never
//! modified: it stays as a fallback.
//!
//! Both directories share Tauri's base (`app_data_dir` is the platform data directory joined
//! with the identifier: `~/Library/Application Support` on macOS, `%APPDATA%` on Windows,
//! `$XDG_DATA_HOME` or `~/.local/share` on Linux), so the old one is resolved as a sibling of
//! the new one.

use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Bundle identifier used before the rename; it names the old data directory.
pub const LEGACY_IDENTIFIER: &str = "com.carlosleon.timetrack";
/// Database file name used before the rename.
pub const LEGACY_DB_FILE: &str = "timetrack.db";

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    /// The new directory already has a database.
    AlreadyPresent,
    /// There is no old database to bring over.
    NothingToMigrate,
    /// The old data was copied; `files` counts the files written.
    Migrated { from: PathBuf, files: usize },
}

/// The old data directory: a sibling of `data_dir` named after [`LEGACY_IDENTIFIER`].
pub fn legacy_data_dir(data_dir: &Path) -> PathBuf {
    data_dir.with_file_name(LEGACY_IDENTIFIER)
}

/// Copies `legacy_dir` into `data_dir` when `data_dir/db_file` does not exist and
/// `legacy_dir/legacy_db_file` does. Files named after the old database (`timetrack.db`,
/// `timetrack.db-wal`, `timetrack.db.bak-v1`...) are renamed after `db_file`.
///
/// Everything is first copied into a staging directory next to `data_dir` and then renamed
/// into place, the database last, so an interrupted run never leaves a half-copied database
/// that a later launch would mistake for a finished migration.
pub fn migrate_legacy_data(
    data_dir: &Path,
    db_file: &str,
    legacy_dir: &Path,
    legacy_db_file: &str,
) -> io::Result<Outcome> {
    if data_dir.join(db_file).exists() {
        return Ok(Outcome::AlreadyPresent);
    }
    if !legacy_dir.join(legacy_db_file).is_file() {
        return Ok(Outcome::NothingToMigrate);
    }

    let staging = staging_dir(data_dir);
    if staging.exists() {
        // Left over by an interrupted run: start again from the old directory.
        fs::remove_dir_all(&staging)?;
    }
    let renamer = |name: &OsString| rename_db_file(name, legacy_db_file, db_file);
    let files = copy_tree(legacy_dir, &staging, &renamer)?;

    if data_dir.exists() {
        move_into(&staging, data_dir, db_file)?;
        fs::remove_dir_all(&staging)?;
    } else {
        fs::rename(&staging, data_dir)?;
    }
    Ok(Outcome::Migrated {
        from: legacy_dir.to_path_buf(),
        files,
    })
}

fn staging_dir(data_dir: &Path) -> PathBuf {
    let mut name = OsString::from(".");
    name.push(data_dir.file_name().unwrap_or_default());
    name.push(".migrating");
    data_dir.with_file_name(name)
}

/// `timetrack.db-wal` becomes `kaiflow.db-wal`; any other name is kept.
fn rename_db_file(name: &OsString, legacy_db_file: &str, db_file: &str) -> OsString {
    match name.to_str().and_then(|n| n.strip_prefix(legacy_db_file)) {
        Some(rest) => OsString::from(format!("{db_file}{rest}")),
        None => name.clone(),
    }
}

/// Recursive copy; `rename` maps the top-level file names only. Returns the files copied.
fn copy_tree(from: &Path, to: &Path, rename: &dyn Fn(&OsString) -> OsString) -> io::Result<usize> {
    fs::create_dir_all(to)?;
    let mut files = 0;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let target = to.join(rename(&entry.file_name()));
        if kind.is_dir() {
            files += copy_tree(&entry.path(), &target, &|n| n.clone())?;
        } else if kind.is_file() {
            fs::copy(entry.path(), &target)?;
            files += 1;
        }
        // Symlinks and other special files are not app data: skipped.
    }
    Ok(files)
}

/// Moves the staged entries into an existing `to`, merging directories and renaming the
/// database file last.
fn move_into(from: &Path, to: &Path, db_file: &str) -> io::Result<()> {
    let mut entries: Vec<_> = fs::read_dir(from)?.collect::<io::Result<_>>()?;
    entries.sort_by_key(|e| e.file_name() == db_file);
    for entry in entries {
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() && target.is_dir() {
            move_into(&entry.path(), &target, db_file)?;
        } else {
            fs::rename(entry.path(), &target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, content: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    fn read(path: &Path) -> String {
        fs::read_to_string(path).unwrap()
    }

    struct Dirs {
        _root: tempfile::TempDir,
        new: PathBuf,
        old: PathBuf,
    }

    fn dirs() -> Dirs {
        let root = tempfile::tempdir().unwrap();
        let new = root.path().join("com.carlosleon.kaiflow");
        let old = legacy_data_dir(&new);
        Dirs {
            _root: root,
            new,
            old,
        }
    }

    fn seed_legacy(old: &Path) {
        write(&old.join("timetrack.db"), "db");
        write(&old.join("timetrack.db-wal"), "wal");
        write(&old.join("timetrack.db-shm"), "shm");
        write(&old.join("timetrack.db.bak-v1"), "bak");
        write(
            &old.join("backups/timetrack-backup-2026-10-19.json.gz"),
            "backup",
        );
    }

    fn migrate(d: &Dirs) -> Outcome {
        migrate_legacy_data(&d.new, "kaiflow.db", &d.old, LEGACY_DB_FILE).unwrap()
    }

    #[test]
    fn the_legacy_dir_is_a_sibling_named_after_the_old_identifier() {
        assert_eq!(
            legacy_data_dir(Path::new("/x/Application Support/com.carlosleon.kaiflow")),
            Path::new("/x/Application Support/com.carlosleon.timetrack")
        );
    }

    #[test]
    fn old_data_is_copied_renamed_and_left_in_place() {
        let d = dirs();
        seed_legacy(&d.old);

        let outcome = migrate(&d);
        assert_eq!(
            outcome,
            Outcome::Migrated {
                from: d.old.clone(),
                files: 5
            }
        );
        assert_eq!(read(&d.new.join("kaiflow.db")), "db");
        assert_eq!(read(&d.new.join("kaiflow.db-wal")), "wal");
        assert_eq!(read(&d.new.join("kaiflow.db-shm")), "shm");
        assert_eq!(read(&d.new.join("kaiflow.db.bak-v1")), "bak");
        assert_eq!(
            read(&d.new.join("backups/timetrack-backup-2026-10-19.json.gz")),
            "backup",
            "backups keep their names: the retention still recognizes them"
        );
        assert_eq!(read(&d.old.join("timetrack.db")), "db", "the old dir stays");
        assert!(!staging_dir(&d.new).exists());
    }

    #[test]
    fn an_existing_new_database_is_never_overwritten() {
        let d = dirs();
        seed_legacy(&d.old);
        write(&d.new.join("kaiflow.db"), "new");

        assert_eq!(migrate(&d), Outcome::AlreadyPresent);
        assert_eq!(read(&d.new.join("kaiflow.db")), "new");
        assert!(!d.new.join("kaiflow.db-wal").exists());
    }

    #[test]
    fn nothing_happens_without_an_old_database() {
        let d = dirs();
        assert_eq!(migrate(&d), Outcome::NothingToMigrate);
        assert!(!d.new.exists());

        write(&d.old.join("backups/notes.txt"), "x");
        assert_eq!(migrate(&d), Outcome::NothingToMigrate);
        assert!(!d.new.exists());
    }

    #[test]
    fn an_existing_new_dir_without_a_database_is_merged_into() {
        let d = dirs();
        seed_legacy(&d.old);
        write(
            &d.new.join("backups/kaiflow-backup-2026-10-20.json.gz"),
            "fresh",
        );
        write(&d.new.join("other.txt"), "keep");

        assert!(matches!(migrate(&d), Outcome::Migrated { files: 5, .. }));
        assert_eq!(read(&d.new.join("kaiflow.db")), "db");
        assert_eq!(read(&d.new.join("other.txt")), "keep");
        assert_eq!(
            read(&d.new.join("backups/kaiflow-backup-2026-10-20.json.gz")),
            "fresh"
        );
        assert_eq!(
            read(&d.new.join("backups/timetrack-backup-2026-10-19.json.gz")),
            "backup"
        );
        assert!(!staging_dir(&d.new).exists());
    }

    #[test]
    fn a_leftover_staging_dir_from_an_interrupted_run_is_replaced() {
        let d = dirs();
        seed_legacy(&d.old);
        write(&staging_dir(&d.new).join("kaiflow.db"), "half");

        assert!(matches!(migrate(&d), Outcome::Migrated { .. }));
        assert_eq!(read(&d.new.join("kaiflow.db")), "db");
    }

    #[test]
    fn a_second_launch_does_nothing() {
        let d = dirs();
        seed_legacy(&d.old);
        migrate(&d);
        write(&d.new.join("kaiflow.db"), "changed since");

        assert_eq!(migrate(&d), Outcome::AlreadyPresent);
        assert_eq!(read(&d.new.join("kaiflow.db")), "changed since");
    }
}
