//! File access for exports and backups. The one rule that matters: a destination file is
//! either untouched or complete, never partial (temp file in the same folder, `fsync`,
//! `rename`, then `fsync` of the folder on Unix).

use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use application::ports::{FileSink, PortError, PortResult};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// [`FileSink`] over the real file system.
#[derive(Debug, Clone, Copy, Default)]
pub struct FsFileSink;

impl FileSink for FsFileSink {
    fn write_atomic(&self, path: &Path, bytes: &[u8]) -> PortResult<()> {
        write_atomic_with(path, bytes, || Ok(()))
    }

    fn list(&self, dir: &Path) -> PortResult<Vec<String>> {
        let entries = match fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(io_error("read the folder", dir, &e)),
        };
        Ok(entries
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_ok_and(|t| t.is_file()))
            .filter_map(|entry| entry.file_name().into_string().ok())
            .collect())
    }

    fn delete(&self, path: &Path) -> PortResult<()> {
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(io_error("delete", path, &e)),
        }
    }

    fn read(&self, path: &Path, max_bytes: u64) -> PortResult<Vec<u8>> {
        let file = File::open(path).map_err(|e| io_error("open", path, &e))?;
        let mut bytes = Vec::new();
        // One byte past the limit tells "exactly the limit" from "longer".
        file.take(max_bytes.saturating_add(1))
            .read_to_end(&mut bytes)
            .map_err(|e| io_error("read", path, &e))?;
        if bytes.len() as u64 > max_bytes {
            return Err(PortError(format!(
                "{} is too large to read",
                path.display()
            )));
        }
        Ok(bytes)
    }
}

/// [`FileSink::write_atomic`] with a hook that runs after the temp file is complete and
/// before it replaces the destination; tests use it to simulate a failure in the middle.
pub fn write_atomic_with(
    path: &Path,
    bytes: &[u8],
    before_rename: impl FnOnce() -> io::Result<()>,
) -> PortResult<()> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map_or_else(|| PathBuf::from("."), Path::to_path_buf);
    fs::create_dir_all(&parent).map_err(|e| io_error("create the folder", &parent, &e))?;

    let name = path.file_name().map(|n| n.to_string_lossy().into_owned());
    let temp = parent.join(format!(
        ".{}.tmp-{}-{}",
        name.ok_or_else(|| PortError(format!("{} is not a file path", path.display())))?,
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));

    let result = (|| {
        let mut file = File::options().write(true).create_new(true).open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        before_rename()?;
        fs::rename(&temp, path)
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&temp);
        return Err(io_error("write", path, &e));
    }
    sync_dir(&parent);
    Ok(())
}

/// Makes the rename itself durable. Best effort: the file is already in place.
#[cfg(unix)]
fn sync_dir(dir: &Path) {
    if let Ok(handle) = File::open(dir) {
        let _ = handle.sync_all();
    }
}

#[cfg(not(unix))]
fn sync_dir(_dir: &Path) {}

fn io_error(action: &str, path: &Path, e: &io::Error) -> PortError {
    PortError(format!("could not {action} {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leftovers(dir: &Path) -> Vec<String> {
        let mut names = FsFileSink.list(dir).unwrap();
        names.sort();
        names
    }

    #[test]
    fn writes_the_whole_file_creating_the_folder_and_leaves_no_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/backups/a.json.gz");
        FsFileSink.write_atomic(&path, b"hello").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"hello");
        assert_eq!(leftovers(path.parent().unwrap()), ["a.json.gz"]);
    }

    #[test]
    fn replacing_swaps_the_content_in_one_step() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.json");
        FsFileSink.write_atomic(&path, b"old").unwrap();
        FsFileSink.write_atomic(&path, b"new content").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new content");
        assert_eq!(leftovers(dir.path()), ["a.json"]);
    }

    #[test]
    fn a_failure_in_the_middle_leaves_no_partial_file_and_keeps_the_previous_one() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.json");

        // Nothing there yet: the failed write leaves nothing at all.
        let failed = write_atomic_with(&path, b"partial?", || {
            Err(io::Error::other("simulated crash"))
        });
        assert!(failed.is_err());
        assert!(leftovers(dir.path()).is_empty());

        // An earlier version stays intact.
        FsFileSink.write_atomic(&path, b"previous").unwrap();
        let failed = write_atomic_with(&path, b"new", || Err(io::Error::other("simulated crash")));
        assert!(failed.unwrap_err().0.contains("simulated crash"));
        assert_eq!(fs::read(&path).unwrap(), b"previous");
        assert_eq!(leftovers(dir.path()), ["a.json"]);
    }

    #[test]
    fn a_destination_that_cannot_be_replaced_cleans_up_its_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        // A folder where the file should go: rename fails.
        let path = dir.path().join("taken");
        fs::create_dir(&path).unwrap();
        assert!(FsFileSink.write_atomic(&path, b"x").is_err());
        assert!(leftovers(dir.path()).is_empty(), "only the folder remains");
        assert!(path.is_dir());
    }

    #[cfg(unix)]
    #[test]
    fn an_unwritable_folder_reports_an_error_and_keeps_earlier_backups() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("kaiflow-backup-2024-01-01.json.gz");
        FsFileSink.write_atomic(&old, b"older").unwrap();
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o555)).unwrap();

        let probe = File::create(dir.path().join("probe"));
        let result = if probe.is_ok() {
            // Running as a user the permission bits do not stop (root): nothing to assert.
            None
        } else {
            Some(FsFileSink.write_atomic(
                &dir.path().join("kaiflow-backup-2024-01-02.json.gz"),
                b"new",
            ))
        };
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o755)).unwrap();

        if let Some(result) = result {
            let message = result.unwrap_err().0;
            assert!(message.contains("could not write"), "{message}");
            assert_eq!(fs::read(&old).unwrap(), b"older");
            assert_eq!(leftovers(dir.path()), ["kaiflow-backup-2024-01-01.json.gz"]);
        }
    }

    #[test]
    fn list_read_and_delete() {
        let dir = tempfile::tempdir().unwrap();
        assert!(
            FsFileSink
                .list(&dir.path().join("missing"))
                .unwrap()
                .is_empty()
        );
        fs::create_dir(dir.path().join("sub")).unwrap();
        let path = dir.path().join("f.json");
        FsFileSink.write_atomic(&path, b"12345").unwrap();
        assert_eq!(leftovers(dir.path()), ["f.json"], "folders are not files");

        assert_eq!(FsFileSink.read(&path, 5).unwrap(), b"12345");
        assert!(FsFileSink.read(&path, 4).is_err());
        assert!(FsFileSink.read(&dir.path().join("nope"), 10).is_err());

        FsFileSink.delete(&path).unwrap();
        FsFileSink.delete(&path).unwrap();
        assert!(leftovers(dir.path()).is_empty());
    }
}
