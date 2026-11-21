//! In-app updates from GitHub Releases, signed with the project's minisign key.
//!
//! Quiet by design: one check a while after start, no polling loop, no retry. When offline
//! that single attempt fails and nothing else is sent until the user presses "Check now".
//! Installing only ever happens on an explicit click in Settings > About.

use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Wait this long after start before the one automatic check, so boot stays untouched.
pub const STARTUP_CHECK_DELAY: Duration = Duration::from_secs(45);

/// A newer release the user can install.
#[derive(Clone, Serialize, PartialEq, Eq, Debug)]
pub struct Available {
    pub version: String,
    pub notes: Option<String>,
}

/// What Settings > About shows.
#[derive(Clone, Serialize, Default, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    /// Milliseconds since the Unix epoch of the last successful check.
    pub checked_at_ms: Option<u64>,
    pub available: Option<Available>,
    /// The last check could not reach the update service.
    pub failed: bool,
}

#[derive(Default)]
pub struct UpdaterState {
    status: Mutex<UpdateStatus>,
    pending: Mutex<Option<Update>>,
}

impl UpdaterState {
    fn snapshot(&self) -> UpdateStatus {
        self.status.lock().map(|s| s.clone()).unwrap_or_default()
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

async fn run_check(app: &AppHandle) -> UpdateStatus {
    let state = app.state::<UpdaterState>();
    let result = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(err) => Err(err),
    };
    let next = match result {
        Ok(found) => {
            let available = found.as_ref().map(|u| Available { version: u.version.clone(), notes: u.body.clone() });
            if let Ok(mut pending) = state.pending.lock() {
                *pending = found;
            }
            UpdateStatus { checked_at_ms: Some(now_ms()), available, failed: false }
        }
        Err(_) => UpdateStatus { failed: true, ..state.snapshot() },
    };
    if let Ok(mut status) = state.status.lock() {
        *status = next.clone();
    }
    next
}

/// Schedules the single automatic check. Called once from setup.
pub fn schedule_startup_check(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(STARTUP_CHECK_DELAY);
        tauri::async_runtime::block_on(run_check(&app));
    });
}

#[tauri::command]
pub fn updater_status(state: State<'_, UpdaterState>) -> UpdateStatus {
    state.snapshot()
}

#[tauri::command]
pub async fn updater_check(app: AppHandle) -> UpdateStatus {
    run_check(&app).await
}

/// Downloads, verifies the signature and runs the installer, which closes the app.
#[tauri::command]
pub async fn updater_install(app: AppHandle) -> Result<(), String> {
    let update = app.state::<UpdaterState>().pending.lock().map_err(|e| e.to_string())?.take();
    let Some(update) = update else { return Err("No update is ready to install.".into()) };
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONF: &str = include_str!("../tauri.conf.json");
    const ENDPOINT: &str = "https://github.com/nAItiklearn/dotDock/releases/latest/download/latest.json";

    fn conf() -> serde_json::Value {
        serde_json::from_str(CONF).expect("tauri.conf.json is valid JSON")
    }

    #[test]
    fn app_version_matches_crate_version() {
        assert_eq!(conf()["version"], env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn updater_points_at_latest_github_release() {
        let c = conf();
        assert_eq!(c["plugins"]["updater"]["endpoints"], serde_json::json!([ENDPOINT]));
        assert_eq!(c["bundle"]["createUpdaterArtifacts"], true);
    }

    #[test]
    fn updater_has_a_minisign_public_key() {
        let key = conf()["plugins"]["updater"]["pubkey"].as_str().unwrap_or_default().to_owned();
        assert!(!key.is_empty());
    }

    #[test]
    fn status_serialises_for_the_settings_page() {
        let status = UpdateStatus {
            checked_at_ms: Some(1),
            available: Some(Available { version: "1.0.1".into(), notes: None }),
            failed: false,
        };
        let json = serde_json::to_value(&status).expect("serialises");
        assert_eq!(
            json,
            serde_json::json!({"checkedAtMs": 1, "available": {"version": "1.0.1", "notes": null}, "failed": false})
        );
    }
}
