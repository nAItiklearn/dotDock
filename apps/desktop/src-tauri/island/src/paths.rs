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

/// `$CODEX_HOME\sessions`, otherwise `%USERPROFILE%\.codex\sessions`: where Codex writes its rollout logs. Codex
/// itself honours `CODEX_HOME`, so a relocated Codex is followed too.
pub fn codex_sessions_dir() -> Option<PathBuf> {
    codex_sessions_dir_from(non_empty_env("CODEX_HOME"), home_dir())
}

fn codex_sessions_dir_from(codex_home: Option<PathBuf>, home: Option<PathBuf>) -> Option<PathBuf> {
    codex_home.or_else(|| home.map(|h| h.join(".codex"))).map(|root| root.join("sessions"))
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from)
}

fn non_empty_env(name: &str) -> Option<PathBuf> {
    std::env::var_os(name).filter(|v| !v.is_empty()).map(PathBuf::from)
}

/// `$COPILOT_HOME`, otherwise `%USERPROFILE%\.copilot`: where GitHub Copilot CLI keeps its configuration and `hooks`.
pub fn copilot_home() -> Option<PathBuf> {
    non_empty_env("COPILOT_HOME").or_else(|| home_dir().map(|h| h.join(".copilot")))
}

/// `$XDG_CONFIG_HOME\opencode`, otherwise `%USERPROFILE%\.config\opencode`: OpenCode's global configuration and `plugins`.
pub fn opencode_config_dir() -> Option<PathBuf> {
    non_empty_env("XDG_CONFIG_HOME")
        .or_else(|| home_dir().map(|h| h.join(".config")))
        .map(|config| config.join("opencode"))
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

    #[test]
    fn codex_home_relocates_the_rollout_logs() {
        let home = Some(PathBuf::from(r"C:\Users\me"));
        assert_eq!(
            codex_sessions_dir_from(None, home.clone()),
            Some(PathBuf::from(r"C:\Users\me").join(".codex").join("sessions"))
        );
        assert_eq!(
            codex_sessions_dir_from(Some(PathBuf::from(r"D:\codex")), home),
            Some(PathBuf::from(r"D:\codex").join("sessions"))
        );
        assert_eq!(codex_sessions_dir_from(None, None), None);
    }
}
