//! Per-app audio sessions (the Windows volume mixer), grouped by executable.

use crate::appname::NameCache;
use crate::com::{process_image_path, take_co_string};
use crate::protocol::AudioApp;
use windows::core::Interface;
use windows::Win32::Media::Audio::{
    AudioSessionStateActive, AudioSessionStateExpired, IAudioSessionControl, IAudioSessionControl2,
    IAudioSessionManager2, ISimpleAudioVolume,
};
use windows::Win32::System::Com::CLSCTX_ALL;

/// Group key and display name of the Windows system-sounds session.
pub const SYSTEM_SOUNDS_ID: &str = "system-sounds";
const SYSTEM_SOUNDS_NAME: &str = "System sounds";

/// One audio session as Windows reports it.
#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    pub instance_id: String,
    pub app_id: String,
    pub exe_path: Option<String>,
    pub fallback_name: String,
    pub volume: f32,
    pub muted: bool,
    pub active: bool,
}

/// A live session: its data and the control to change it or listen to it.
pub struct Session {
    pub row: Row,
    pub control: IAudioSessionControl,
}

pub fn manager_for(device: &windows::Win32::Media::Audio::IMMDevice) -> Result<IAudioSessionManager2, String> {
    // SAFETY: Activate returns a new interface owned by the caller.
    unsafe { device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) }.map_err(|e| format!("session manager: {e}"))
}

/// All sessions that have not expired.
pub fn read(manager: &IAudioSessionManager2) -> Vec<Session> {
    // SAFETY: enumerator and controls are COM objects released on drop; strings are freed by take_co_string.
    unsafe {
        let Ok(list) = manager.GetSessionEnumerator() else { return Vec::new() };
        let count = list.GetCount().unwrap_or(0);
        (0..count)
            .filter_map(|i| list.GetSession(i).ok())
            .filter_map(|control| {
                let state = control.GetState().ok()?;
                if state == AudioSessionStateExpired {
                    return None;
                }
                let control2 = control.cast::<IAudioSessionControl2>().ok()?;
                let simple = control.cast::<ISimpleAudioVolume>().ok()?;
                let pid = control2.GetProcessId().unwrap_or(0);
                let system = control2.IsSystemSoundsSession().is_ok();
                let exe_path = process_image_path(pid);
                let app_id = app_id(system, exe_path.as_deref(), pid);
                let display = control.GetDisplayName().map(take_co_string).unwrap_or_default();
                let fallback_name = if system {
                    SYSTEM_SOUNDS_NAME.to_owned()
                } else if display.is_empty() || display.starts_with('@') {
                    format!("App {pid}")
                } else {
                    display
                };
                Some(Session {
                    row: Row {
                        instance_id: control2.GetSessionInstanceIdentifier().map(take_co_string).unwrap_or_default(),
                        app_id,
                        exe_path,
                        fallback_name,
                        volume: simple.GetMasterVolume().unwrap_or(1.0).clamp(0.0, 1.0),
                        muted: simple.GetMute().map(|b| b.as_bool()).unwrap_or(false),
                        active: state == AudioSessionStateActive,
                    },
                    control,
                })
            })
            .collect()
    }
}

fn app_id(system: bool, exe: Option<&str>, pid: u32) -> String {
    if system {
        SYSTEM_SOUNDS_ID.to_owned()
    } else if let Some(exe) = exe {
        exe.to_lowercase()
    } else {
        format!("pid:{pid}")
    }
}

/// One entry per app, named the way the volume mixer names it.
pub fn group(rows: &[Row], names: &mut NameCache) -> Vec<AudioApp> {
    let mut apps: Vec<AudioApp> = Vec::new();
    for row in rows {
        if let Some(app) = apps.iter_mut().find(|a| a.id == row.app_id) {
            app.active |= row.active;
            app.muted &= row.muted;
            app.volume = app.volume.max(row.volume);
            continue;
        }
        let name = match &row.exe_path {
            Some(path) if row.app_id != SYSTEM_SOUNDS_ID => names.name_for(path),
            _ => row.fallback_name.clone(),
        };
        apps.push(AudioApp {
            id: row.app_id.clone(),
            name,
            exe_path: row.exe_path.clone(),
            volume: row.volume,
            muted: row.muted,
            active: row.active,
        });
    }
    apps.sort_by(|a, b| b.active.cmp(&a.active).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    apps
}

/// Applies `change` to the volume control of every session of one app.
pub fn for_app(
    manager: &IAudioSessionManager2,
    app_id: &str,
    change: impl Fn(&ISimpleAudioVolume) -> windows::core::Result<()>,
) -> Result<(), String> {
    let sessions = read(manager);
    let mut found = false;
    for s in sessions.iter().filter(|s| s.row.app_id == app_id) {
        found = true;
        let simple = s.control.cast::<ISimpleAudioVolume>().map_err(|e| e.to_string())?;
        change(&simple).map_err(|e| format!("could not change the app's volume: {e}"))?;
    }
    if found {
        Ok(())
    } else {
        Err("that app is no longer playing audio".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(app_id: &str, volume: f32, muted: bool, active: bool) -> Row {
        Row {
            instance_id: format!("{app_id}-{volume}"),
            app_id: app_id.to_owned(),
            exe_path: None,
            fallback_name: app_id.to_owned(),
            volume,
            muted,
            active,
        }
    }

    #[test]
    fn sessions_of_one_app_become_one_entry() {
        let rows = [row("chrome", 0.4, true, false), row("chrome", 0.8, false, true), row("zoom", 0.5, false, false)];
        let apps = group(&rows, &mut NameCache::default());
        assert_eq!(apps.len(), 2);
        let chrome = apps.iter().find(|a| a.id == "chrome").unwrap();
        assert!(chrome.active && !chrome.muted);
        assert_eq!(chrome.volume, 0.8);
    }

    #[test]
    fn active_apps_come_first() {
        let rows = [row("alpha", 1.0, false, false), row("beta", 1.0, false, true)];
        let apps = group(&rows, &mut NameCache::default());
        assert_eq!(apps[0].id, "beta");
    }

    #[test]
    fn ids_are_stable_per_executable() {
        assert_eq!(app_id(true, None, 0), SYSTEM_SOUNDS_ID);
        assert_eq!(app_id(false, Some(r"C:\Apps\Chrome.exe"), 4), r"c:\apps\chrome.exe");
        assert_eq!(app_id(false, None, 4), "pid:4");
    }
}
