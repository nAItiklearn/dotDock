//! Puts the hook executable where Claude Code's settings can point at it for good.
//!
//! The copy lives in the app's own data folder under a name that includes a hash of its contents, so:
//! - the registered path survives app updates, moves and portable runs;
//! - an update never has to overwrite an executable that Claude Code is running right now.

use crate::connect::HOOK_MARKER;
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum InstallError {
    #[error("the hook executable was not found at {0}")]
    SourceMissing(PathBuf),
    #[error("copying the hook executable: {0}")]
    Io(#[from] std::io::Error),
}

/// FNV-1a, 64 bit. A name, not a security boundary.
fn fingerprint(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |hash, b| (hash ^ u64::from(*b)).wrapping_mul(0x0100_0000_01b3))
}

fn is_installed_copy(path: &Path) -> bool {
    path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(HOOK_MARKER) && n.ends_with(".exe"))
}

/// Copies `source` into `dest_dir` as `dotdock-island-hook-<hash>.exe` (once) and returns that path.
/// Older copies stay until `remove_old` runs, so settings that still point at them keep working until
/// Connect has repointed them.
pub fn install(source: &Path, dest_dir: &Path) -> Result<PathBuf, InstallError> {
    let bytes = std::fs::read(source).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            InstallError::SourceMissing(source.to_owned())
        } else {
            InstallError::Io(e)
        }
    })?;
    let target = dest_dir.join(format!("{HOOK_MARKER}-{:016x}.exe", fingerprint(&bytes)));
    let intact = std::fs::metadata(&target).is_ok_and(|m| m.len() == bytes.len() as u64);
    if !intact {
        crate::util::write_atomic(&target, &bytes)?;
    }
    Ok(target)
}

/// Deletes every installed copy except `keep`. Call it after Connect has repointed the settings. A copy that is
/// still running cannot be deleted on Windows and is left for next time. Returns how many were removed.
pub fn remove_old(dest_dir: &Path, keep: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(dest_dir) else { return 0 };
    entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p != keep && is_installed_copy(p))
        .filter(|p| std::fs::remove_file(p).is_ok())
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installs_under_a_content_addressed_name_and_is_idempotent() {
        let dir = tempfile::tempdir().expect("tempdir");
        let source = dir.path().join("dotdock-island-hook.exe");
        std::fs::write(&source, b"version one").expect("source");
        let dest = dir.path().join("data").join("island");
        let first = install(&source, &dest).expect("install");
        assert!(first.file_name().expect("name").to_string_lossy().starts_with("dotdock-island-hook-"));
        assert_eq!(std::fs::read(&first).expect("read"), b"version one");
        assert_eq!(install(&source, &dest).expect("again"), first);
    }

    #[test]
    fn a_new_build_gets_a_new_name_and_the_old_copy_goes_after_repointing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let source = dir.path().join("hook.exe");
        let dest = dir.path().join("island");
        std::fs::write(&source, b"one").expect("source");
        let one = install(&source, &dest).expect("one");
        std::fs::write(&source, b"two, longer").expect("source");
        let two = install(&source, &dest).expect("two");
        assert_ne!(one, two);
        assert!(one.exists(), "the old copy stays until the settings are repointed");
        assert_eq!(remove_old(&dest, &two), 1);
        assert!(!one.exists() && two.exists());
        assert_eq!(std::fs::read(&two).expect("read"), b"two, longer");
    }

    #[test]
    fn a_truncated_copy_is_repaired() {
        let dir = tempfile::tempdir().expect("tempdir");
        let source = dir.path().join("hook.exe");
        let dest = dir.path().join("island");
        std::fs::write(&source, b"complete contents").expect("source");
        let copy = install(&source, &dest).expect("install");
        std::fs::write(&copy, b"cut").expect("truncate");
        install(&source, &dest).expect("repair");
        assert_eq!(std::fs::read(&copy).expect("read"), b"complete contents");
    }

    #[test]
    fn a_missing_source_is_a_clear_error() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(matches!(install(&dir.path().join("none.exe"), dir.path()), Err(InstallError::SourceMissing(_))));
    }
}
