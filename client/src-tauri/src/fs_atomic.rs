//! The client's own files, written so a crash or power cut never leaves half of
//! one, and read so a file that is damaged anyway is noticed and kept.

use crate::lock::LockExt;
use serde::de::DeserializeOwned;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// One write at a time across the process. Every file has a single temporary
/// name beside it, so two writers of the same file must not share it; the
/// files are a few kilobytes and written seldom, so one lock for all costs
/// nothing.
static WRITING: Mutex<()> = Mutex::new(());

fn beside(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

/// Write a file so that it is either the old one or the new one, never half of
/// each: the new bytes go to `<name>.tmp` beside it — the same folder, since a
/// rename across file systems is a copy — are flushed to the disk, and the
/// temporary then takes the file's name.
pub(crate) fn write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let _one_at_a_time = WRITING.lock_or_recover();
    let temp = beside(path, ".tmp");
    let written = (|| {
        let mut file = fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()
    })();
    if let Err(e) = written.and_then(|_| fs::rename(&temp, path)) {
        let _ = fs::remove_file(&temp);
        return Err(e);
    }
    // The rename itself lives in the folder; without this a power cut can
    // still bring back the old name. Windows cannot open a folder this way,
    // and its rename is already written through.
    #[cfg(unix)]
    if let Some(dir) = path.parent() {
        if let Ok(dir) = fs::File::open(dir) {
            let _ = dir.sync_all();
        }
    }
    Ok(())
}

/// Read one of the client's JSON files.
///
/// `None` when it is not there, which is the normal first start. A file that
/// is there and does not parse used to be passed over in silence and then
/// replaced by defaults on the next save; now the log names it and its bytes
/// are kept as `<name>.corrupt` first, once per distinct content, so whatever
/// it held can still be looked at.
pub(crate) fn read_json<T: DeserializeOwned>(path: &Path) -> Option<T> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return None,
        Err(e) => {
            log::warn!("{} could not be read ({e}); using defaults", path.display());
            return None;
        }
    };
    match serde_json::from_slice(&bytes) {
        Ok(value) => Some(value),
        Err(e) => {
            keep_corrupt(path, &bytes, &e);
            None
        }
    }
}

fn keep_corrupt(path: &Path, bytes: &[u8], why: &serde_json::Error) {
    let kept = beside(path, ".corrupt");
    // Files read on every use (settings.json) would otherwise log and copy on
    // every call for as long as the damage lasts.
    if fs::read(&kept).is_ok_and(|old| old == bytes) {
        return;
    }
    match write(&kept, bytes) {
        Ok(()) => log::warn!(
            "{} is damaged ({why}); using defaults, the damaged copy is kept as {}",
            path.display(),
            kept.display()
        ),
        Err(e) => log::warn!(
            "{} is damaged ({why}); using defaults, and it could not be kept as {} ({e})",
            path.display(),
            kept.display()
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("starbuddy-fs-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn names_in(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> =
            fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        names
    }

    #[test]
    fn preferences_are_replaced_whole_and_leave_nothing_behind() {
        let dir = scratch("prefs");
        let path = dir.join("client.json");

        write(&path, b"{\"live_dir\":\"first\"}").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"{\"live_dir\":\"first\"}");
        // A shorter file over a longer one: nothing of the old one survives.
        write(&path, b"{}").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"{}");
        // The new bytes were written beside the file, in the same folder — a
        // rename across file systems is a copy — and the temporary is gone.
        assert_eq!(names_in(&dir), vec!["client.json".to_string()]);

        // A folder where the file should be cannot be replaced, and the
        // temporary does not stay behind as litter.
        let blocked = dir.join("blocked");
        fs::create_dir_all(blocked.join("inside")).unwrap();
        assert!(write(&blocked, b"{}").is_err());
        assert!(!dir.join("blocked.tmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_damaged_file_is_kept_aside_once_and_read_as_absent() {
        let dir = scratch("corrupt");
        let path = dir.join("overlay.json");

        assert_eq!(read_json::<serde_json::Value>(&path), None, "a missing file is just absent");
        assert_eq!(names_in(&dir), Vec::<String>::new());

        fs::write(&path, b"{\"windows\": {").unwrap();
        assert_eq!(read_json::<serde_json::Value>(&path), None);
        assert_eq!(fs::read(dir.join("overlay.json.corrupt")).unwrap(), b"{\"windows\": {");
        // The damaged file itself is left alone: the next save replaces it.
        assert_eq!(fs::read(&path).unwrap(), b"{\"windows\": {");

        // Read again, the same damage is not copied again (mtime unchanged).
        let kept_at = fs::metadata(dir.join("overlay.json.corrupt")).unwrap().modified().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        assert_eq!(read_json::<serde_json::Value>(&path), None);
        assert_eq!(fs::metadata(dir.join("overlay.json.corrupt")).unwrap().modified().unwrap(), kept_at);

        write(&path, b"{\"ok\":true}").unwrap();
        assert_eq!(read_json::<serde_json::Value>(&path), Some(serde_json::json!({"ok": true})));
        let _ = fs::remove_dir_all(&dir);
    }
}
