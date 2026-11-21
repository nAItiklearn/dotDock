//! The few choices the tiles remember between runs, in `tiles-settings.json`.

use crate::emit::lock;
use crate::paths;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Serialize, Deserialize, Default, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Values {
    /// Keep the clipboard history, encrypted, between runs. Off unless the user turns it on.
    pub clipboard_persisted: bool,
    /// The `.ics` file the calendar tile reads when Windows' appointment store has nothing for it.
    pub calendar_ics_path: Option<String>,
}

#[derive(Clone)]
pub struct Settings {
    path: PathBuf,
    values: Arc<Mutex<Values>>,
}

impl Settings {
    pub fn load(path: PathBuf) -> Self {
        let values = paths::read_json::<Values>(&path).unwrap_or_default();
        Self { path, values: Arc::new(Mutex::new(values)) }
    }

    pub fn get(&self) -> Values {
        lock(&self.values).clone()
    }

    /// Applies `change` and saves the file when something changed.
    pub fn update(&self, change: impl FnOnce(&mut Values)) -> Result<(), String> {
        let mut values = lock(&self.values);
        let before = values.clone();
        change(&mut values);
        if *values == before {
            return Ok(());
        }
        paths::write_json(&self.path, &*values)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_persist_and_default_to_off() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tiles-settings.json");
        let s = Settings::load(path.clone());
        assert!(!s.get().clipboard_persisted);
        s.update(|v| v.clipboard_persisted = true).unwrap();
        assert!(Settings::load(path).get().clipboard_persisted);
    }

    #[test]
    fn an_unchanged_update_writes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tiles-settings.json");
        let s = Settings::load(path.clone());
        s.update(|_| {}).unwrap();
        assert!(!path.exists());
    }
}
