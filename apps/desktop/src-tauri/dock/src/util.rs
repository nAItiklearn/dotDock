//! Small helpers shared by the modules: path and name normalisation, a stable hash, wall-clock time.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// FNV-1a 64-bit offset basis and prime (the published constants).
const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

/// A stable 64-bit hash for cache file names. `DefaultHasher` is not specified to stay the same between
/// Rust releases, and a cache that renames itself on every toolchain bump would re-extract every icon.
pub fn stable_hash(parts: &[&str]) -> u64 {
    let mut h = FNV_OFFSET;
    for part in parts {
        for byte in part.bytes().chain(std::iter::once(0)) {
            h ^= u64::from(byte);
            h = h.wrapping_mul(FNV_PRIME);
        }
    }
    h
}

/// Lower-cases and unifies separators so two spellings of one path compare equal. Does not touch the disk.
pub fn normalise_path(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for c in path.trim().trim_matches('"').chars() {
        out.push(if c == '/' { '\\' } else { c.to_ascii_lowercase() });
    }
    while out.ends_with('\\') && out.len() > 3 {
        out.pop();
    }
    out
}

/// Lower-cased file name of a path (`C:\x\Code.exe` gives `code.exe`).
pub fn file_name_lower(path: &str) -> Option<String> {
    let name = path.rsplit(['\\', '/']).next()?;
    (!name.is_empty()).then(|| name.to_ascii_lowercase())
}

/// Lower-case alphanumeric words separated by single spaces: `Visual Studio Code (x64)` becomes
/// `visual studio code x64`. The form the classifier matches names in.
pub fn normalise_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut pending_space = false;
    for c in name.chars() {
        if c.is_alphanumeric() {
            if pending_space && !out.is_empty() {
                out.push(' ');
            }
            pending_space = false;
            out.extend(c.to_lowercase());
        } else if c == '+' || c == '#' {
            // "Notepad++" and "C#" must not collapse into the plain word.
            out.push(c);
        } else {
            pending_space = true;
        }
    }
    out
}

/// Replaces `%NAME%` with the environment variable's value; a variable that is not set is left as written.
pub fn expand_env(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('%') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        let Some(close) = after.find('%') else {
            out.push_str(&rest[open..]);
            return out;
        };
        let name = &after[..close];
        match std::env::var(name) {
            Ok(value) if !name.is_empty() => out.push_str(&value),
            _ => out.push_str(&rest[open..open + close + 2]),
        }
        rest = &after[close + 1..];
    }
    out.push_str(rest);
    out
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// Seconds since the epoch of a file's modification time, 0 when it cannot be read. Used in icon cache keys.
pub fn mtime_secs(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_is_stable_and_order_sensitive() {
        assert_eq!(stable_hash(&["a", "b"]), stable_hash(&["a", "b"]));
        assert_ne!(stable_hash(&["a", "b"]), stable_hash(&["ab", ""]));
        assert_ne!(stable_hash(&["a", "b"]), stable_hash(&["b", "a"]));
        // An empty part still hashes its zero terminator, which keeps the constants honest.
        assert_eq!(stable_hash(&[""]), FNV_OFFSET.wrapping_mul(FNV_PRIME));
    }

    #[test]
    fn paths_compare_case_and_separator_blind() {
        assert_eq!(normalise_path("C:/Program Files/App/App.EXE"), normalise_path("c:\\program files\\app\\app.exe"));
        assert_eq!(normalise_path("\"C:\\X\\\""), "c:\\x");
        assert_eq!(normalise_path("C:\\"), "c:\\");
    }

    #[test]
    fn names_normalise_to_words() {
        assert_eq!(normalise_name("Visual Studio Code (x64)"), "visual studio code x64");
        assert_eq!(normalise_name("  Notepad++ "), "notepad++");
        assert_eq!(normalise_name("DaVinci-Resolve_18"), "davinci resolve 18");
        assert_eq!(normalise_name("C# Interactive"), "c# interactive");
    }

    #[test]
    fn environment_variables_expand() {
        std::env::set_var("DOCKDOCK_TEST_DIR", "C:\\Tools");
        assert_eq!(expand_env("%DOCKDOCK_TEST_DIR%\\app.ico"), "C:\\Tools\\app.ico");
        assert_eq!(expand_env("a%DOCKDOCK_TEST_DIR%b%DOCKDOCK_TEST_DIR%c"), "aC:\\ToolsbC:\\Toolsc");
        assert_eq!(expand_env("%DOCKDOCK_NOT_SET_ANYWHERE%\\x"), "%DOCKDOCK_NOT_SET_ANYWHERE%\\x");
        assert_eq!(expand_env("100%"), "100%");
        assert_eq!(expand_env("no variables"), "no variables");
        assert_eq!(expand_env("%%"), "%%");
    }

    #[test]
    fn file_names_lower() {
        assert_eq!(file_name_lower("C:\\Apps\\Code.EXE").as_deref(), Some("code.exe"));
        assert_eq!(file_name_lower("C:\\Apps\\").as_deref(), None);
    }
}
