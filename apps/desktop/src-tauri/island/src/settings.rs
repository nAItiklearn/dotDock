//! The island's user settings: schema-versioned, clamped on load, saved atomically.
//! Mirrors `IslandSettings` in `src/island/protocol.ts`.

use crate::engine::EngineConfig;
use crate::util::write_atomic;
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const SCHEMA: u32 = 1;
pub const FILE_NAME: &str = "island-settings.json";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IdleMode {
    /// A tiny standby pill stays on screen.
    #[default]
    Tiny,
    Hidden,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IconStyle {
    #[default]
    Dots,
    Blocks,
    Stripes,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct IslandSettings {
    pub schema: u32,
    pub idle: IdleMode,
    pub scale: f64,
    pub top_offset: u32,
    pub icon_style: IconStyle,
    pub show_detail: bool,
    pub show_tokens: bool,
    pub show_elapsed: bool,
    pub show_project: bool,
    /// The creature and landscape strip along the bottom of the island.
    pub show_scene: bool,
    pub move_aside: bool,
    pub follow_cursor: bool,
    pub codex: bool,
    pub notify: bool,
    pub sound: bool,
    pub volume: f64,
    pub done_linger_secs: u32,
}

impl Default for IslandSettings {
    fn default() -> Self {
        Self {
            schema: SCHEMA,
            idle: IdleMode::Tiny,
            scale: 1.0,
            top_offset: 10,
            icon_style: IconStyle::Dots,
            show_detail: true,
            show_tokens: true,
            show_elapsed: false,
            show_project: false,
            show_scene: true,
            move_aside: true,
            follow_cursor: true,
            codex: true,
            notify: true,
            sound: true,
            volume: 0.5,
            done_linger_secs: 6,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error("settings file: {0}")]
    Io(#[from] std::io::Error),
    #[error("settings json: {0}")]
    Json(#[from] serde_json::Error),
}

const SCALE_RANGE: (f64, f64) = (0.8, 1.4);
const TOP_OFFSET_MAX: u32 = 64;
const LINGER_RANGE: (u32, u32) = (2, 30);

impl IslandSettings {
    /// Forces every value into its documented range. NaN and infinities fall back to the default.
    pub fn sanitized(mut self) -> Self {
        let defaults = Self::default();
        self.schema = SCHEMA;
        self.scale =
            if self.scale.is_finite() { self.scale.clamp(SCALE_RANGE.0, SCALE_RANGE.1) } else { defaults.scale };
        self.volume = if self.volume.is_finite() { self.volume.clamp(0.0, 1.0) } else { defaults.volume };
        self.top_offset = self.top_offset.min(TOP_OFFSET_MAX);
        self.done_linger_secs = self.done_linger_secs.clamp(LINGER_RANGE.0, LINGER_RANGE.1);
        self
    }

    /// Reads the file; a missing, unreadable or newer-schema file gives the defaults (the bad file is kept
    /// next to it as `.bak` so nothing is lost).
    pub fn load(path: &Path) -> Self {
        let Ok(text) = std::fs::read_to_string(path) else { return Self::default() };
        let text = text.trim_start_matches('\u{feff}');
        match serde_json::from_str::<Self>(text) {
            Ok(parsed) if parsed.schema <= SCHEMA => parsed.sanitized(),
            _ => {
                let _ = std::fs::copy(path, path.with_extension("json.bak"));
                Self::default()
            }
        }
    }

    pub fn save(&self, path: &Path) -> Result<(), SettingsError> {
        write_atomic(path, &serde_json::to_vec_pretty(&self.clone().sanitized())?)?;
        Ok(())
    }

    /// How long the engine keeps each phase on screen under these settings.
    pub fn engine_config(&self) -> EngineConfig {
        EngineConfig { linger_done_ms: u64::from(self.done_linger_secs) * 1_000, ..EngineConfig::default() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_the_typescript_defaults() {
        let json = serde_json::to_value(IslandSettings::default()).expect("json");
        assert_eq!(json["idle"], "tiny");
        assert_eq!(json["iconStyle"], "dots");
        assert_eq!(json["topOffset"], 10);
        assert_eq!(json["doneLingerSecs"], 6);
        assert_eq!(json["showScene"], true);
        assert_eq!(json["volume"], 0.5);
        assert_eq!(json["schema"], 1);
    }

    #[test]
    fn out_of_range_values_are_clamped() {
        let wild = IslandSettings {
            scale: 9.0,
            volume: -2.0,
            top_offset: 900,
            done_linger_secs: 0,
            ..IslandSettings::default()
        };
        let tame = wild.sanitized();
        assert_eq!((tame.scale, tame.volume, tame.top_offset, tame.done_linger_secs), (1.4, 0.0, 64, 2));
        let nan = IslandSettings { scale: f64::NAN, volume: f64::INFINITY, ..IslandSettings::default() }.sanitized();
        assert_eq!((nan.scale, nan.volume), (1.0, 0.5));
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join(FILE_NAME);
        let settings = IslandSettings {
            idle: IdleMode::Hidden,
            icon_style: IconStyle::Stripes,
            scale: 1.2,
            codex: false,
            ..IslandSettings::default()
        };
        settings.save(&path).expect("save");
        assert_eq!(IslandSettings::load(&path), settings);
    }

    /// Earlier builds had a per-part "Show the island" switch. A file written by one still loads, keeps
    /// every other choice, and the island shows: the only off switch is the dotDock theme itself.
    #[test]
    fn a_file_from_before_the_island_switch_was_removed_still_loads() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join(FILE_NAME);
        std::fs::write(&path, r#"{"schema":1,"enabled":false,"idle":"hidden","scale":1.2}"#).expect("write");
        let loaded = IslandSettings::load(&path);
        assert_eq!(loaded.idle, IdleMode::Hidden);
        assert_eq!(loaded.scale, 1.2);
        assert!(!path.with_extension("json.bak").exists(), "not treated as damaged");
        assert!(serde_json::to_value(&loaded).expect("json").get("enabled").is_none());
    }

    #[test]
    fn partial_files_fill_in_defaults() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join(FILE_NAME);
        std::fs::write(&path, br#"{"schema":1,"sound":false}"#).expect("write");
        let loaded = IslandSettings::load(&path);
        assert!(!loaded.sound);
        assert_eq!(loaded.scale, 1.0);
    }

    #[test]
    fn corrupt_or_future_files_fall_back_and_are_backed_up() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join(FILE_NAME);
        std::fs::write(&path, b"{oops").expect("write");
        assert_eq!(IslandSettings::load(&path), IslandSettings::default());
        assert!(dir.path().join("island-settings.json.bak").exists());
        std::fs::write(&path, br#"{"schema":99,"sound":false}"#).expect("write");
        assert!(IslandSettings::load(&path).sound);
        assert_eq!(IslandSettings::load(&dir.path().join("missing.json")), IslandSettings::default());
    }

    #[test]
    fn linger_setting_drives_the_engine() {
        let settings = IslandSettings { done_linger_secs: 12, ..IslandSettings::default() };
        assert_eq!(settings.engine_config().linger_done_ms, 12_000);
    }
}
