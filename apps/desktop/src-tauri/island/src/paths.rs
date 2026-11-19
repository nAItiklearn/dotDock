//! Where Claude Code keeps its files and where the island keeps its own.

use std::path::{Path, PathBuf};

/// Environment variable Claude Code honours to relocate its configuration folder.
const CONFIG_DIR_ENV: &str = "CLAUDE_CONFIG_DIR";

/// Folders under Claude Code's configuration folder. Always built from one root so tests can use a temp folder.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClaudeDirs {
    config_dir: PathBuf,
}

impl ClaudeDirs {
    pub fn at(config_dir: impl Into<PathBuf>) -> Self {
        Self { config_dir: config_dir.into() }
    }

    /// `CLAUDE_CONFIG_DIR` if set, otherwise `%USERPROFILE%\.claude`.
    pub fn from_env() -> Option<Self> {
        if let Some(dir) = std::env::var_os(CONFIG_DIR_ENV).filter(|v| !v.is_empty()) {
            return Some(Self::at(PathBuf::from(dir)));
        }
        let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
        Some(Self::at(PathBuf::from(home).join(".claude")))
    }

    pub fn config_dir(&self) -> &Path {
        &self.config_dir
    }

    /// The user-level settings file that Connect edits. Project settings are never touched.
    pub fn settings_file(&self) -> PathBuf {
        self.config_dir.join("settings.json")
    }

    /// `<config>\tools\island`, the island's own folder.
    pub fn island_dir(&self) -> PathBuf {
        self.config_dir.join("tools").join("island")
    }

    /// One `<session id>.json` file per Claude Code session.
    pub fn sessions_dir(&self) -> PathBuf {
        self.island_dir().join("sessions")
    }
}

/// `%USERPROFILE%\.codex\sessions`, where Codex writes its rollout logs.
pub fn codex_sessions_dir() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    Some(PathBuf::from(home).join(".codex").join("sessions"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_follows_the_spec() {
        let dirs = ClaudeDirs::at(r"C:\Users\me\.claude");
        assert_eq!(dirs.settings_file(), PathBuf::from(r"C:\Users\me\.claude").join("settings.json"));
        assert_eq!(
            dirs.sessions_dir(),
            PathBuf::from(r"C:\Users\me\.claude").join("tools").join("island").join("sessions")
        );
    }
}
