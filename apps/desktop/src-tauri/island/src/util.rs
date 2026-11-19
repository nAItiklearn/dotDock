//! Small helpers shared by the hook and the app: clocks, atomic file writes, text clipping.

use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Milliseconds since the Unix epoch (0 if the clock is before it).
pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX)).unwrap_or(0)
}

/// Nanoseconds since the Unix epoch. Used to order hook events that arrive within the same millisecond.
pub fn now_ns() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| u64::try_from(d.as_nanos()).unwrap_or(u64::MAX)).unwrap_or(0)
}

/// How often a rename is retried when another process holds the target open (Windows sharing violations).
const RENAME_RETRIES: u32 = 6;
const RENAME_BACKOFF: Duration = Duration::from_millis(4);
/// ERROR_SHARING_VIOLATION and ERROR_LOCK_VIOLATION.
const SHARING_VIOLATION: i32 = 32;
const LOCK_VIOLATION: i32 = 33;

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

fn is_transient(err: &io::Error) -> bool {
    err.kind() == io::ErrorKind::PermissionDenied
        || matches!(err.raw_os_error(), Some(SHARING_VIOLATION | LOCK_VIOLATION))
}

/// Writes `bytes` to a sibling temp file and renames it over `path`, so a reader never sees a half-written file.
/// The temp name starts with a dot and ends in `.tmp`; watchers ignore it.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = path.parent().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no parent folder"))?;
    let name = path.file_name().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no file name"))?;
    let unique = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp = dir.join(format!(".{}.{}.{}.tmp", name.to_string_lossy(), std::process::id(), unique));
    // The folder almost always exists; creating it up front would cost a syscall on every hook run.
    if let Err(err) = std::fs::write(&tmp, bytes) {
        if err.kind() != io::ErrorKind::NotFound {
            return Err(err);
        }
        std::fs::create_dir_all(dir)?;
        std::fs::write(&tmp, bytes)?;
    }
    let mut attempt = 0;
    loop {
        match std::fs::rename(&tmp, path) {
            Ok(()) => return Ok(()),
            Err(err) if attempt < RENAME_RETRIES && is_transient(&err) => {
                attempt += 1;
                std::thread::sleep(RENAME_BACKOFF);
            }
            Err(err) => {
                let _ = std::fs::remove_file(&tmp);
                return Err(err);
            }
        }
    }
}

/// Clips to `max` characters (not bytes) and appends an ellipsis when something was cut.
pub fn clip(text: &str, max: usize) -> String {
    let mut chars = text.chars();
    let head: String = chars.by_ref().take(max).collect();
    if chars.next().is_some() {
        format!("{}…", head.trim_end())
    } else {
        head
    }
}

/// Last path component for both `\` and `/` separators; the input itself if it has none.
pub fn basename(path: &str) -> &str {
    let trimmed = path.trim_end_matches(['/', '\\']);
    trimmed.rsplit(['/', '\\']).next().filter(|s| !s.is_empty()).unwrap_or(trimmed)
}

/// Keeps only characters that are safe in a file name; a session id becomes a file name.
pub fn sanitize_id(raw: &str) -> String {
    raw.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(64).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clip_counts_chars_and_marks_the_cut() {
        assert_eq!(clip("abcdef", 3), "abc…");
        assert_eq!(clip("abc", 3), "abc");
        assert_eq!(clip("héllo wörld", 5), "héllo…");
        assert_eq!(clip("", 4), "");
    }

    #[test]
    fn basename_handles_both_separators() {
        assert_eq!(basename(r"C:\work\dotDock\lib.rs"), "lib.rs");
        assert_eq!(basename("/home/me/app/main.ts"), "main.ts");
        assert_eq!(basename("D:\\work\\proj\\"), "proj");
        assert_eq!(basename("plain"), "plain");
        assert_eq!(basename(""), "");
    }

    #[test]
    fn sanitize_id_strips_path_tricks() {
        assert_eq!(sanitize_id("abc-123_DEF"), "abc-123_DEF");
        assert_eq!(sanitize_id("../../evil\\name.json"), "evilnamejson");
        assert_eq!(sanitize_id(&"a".repeat(200)).len(), 64);
    }

    #[test]
    fn write_atomic_replaces_and_leaves_no_temp_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let target = dir.path().join("nested").join("state.json");
        write_atomic(&target, b"one").expect("first write");
        write_atomic(&target, b"two").expect("second write");
        assert_eq!(std::fs::read_to_string(&target).expect("read"), "two");
        let leftovers: Vec<_> = std::fs::read_dir(target.parent().expect("parent"))
            .expect("list")
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }
}
