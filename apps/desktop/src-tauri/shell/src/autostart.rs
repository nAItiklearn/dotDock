//! Launch at sign-in, as early as Windows allows, and fully reversible.
//!
//! Primary: a per-user logon task (fires at sign-in, independent of Explorer's
//! startup-app delay) at normal priority. Fallback: the HKCU Run key.
//! Both paths also set Explorer's StartupDelayInMSec to 0.

use crate::{registry, snapshot, AUTOSTART_NAME, RUN_KEY, SERIALIZE_KEY, STARTUP_DELAY_VALUE};
use std::os::windows::process::CommandExt;
use std::process::Command;

/// Flag passed by the autostart entry so boot timing can tell a sign-in launch apart.
pub const AUTOSTART_ARG: &str = "--autostart";
/// Do not flash a console window when running schtasks.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, PartialEq, Eq)]
pub enum Method {
    LogonTask,
    RunKey,
}

#[derive(Debug, thiserror::Error)]
pub enum AutostartError {
    #[error(transparent)]
    Snapshot(#[from] snapshot::SnapshotError),
    #[error(transparent)]
    Registry(#[from] registry::RegistryError),
    #[error("cannot locate the running executable: {0}")]
    Exe(std::io::Error),
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn task_xml(exe: &str, user: &str) -> String {
    // Priority 4 = normal. Task Scheduler's default (7) is below normal and would slow boot.
    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Starts the desktop widgets at sign-in.</Description></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>{user}</UserId></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>{user}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>4</Priority>
  </Settings>
  <Actions Context="Author"><Exec><Command>{exe}</Command><Arguments>{AUTOSTART_ARG}</Arguments></Exec></Actions>
</Task>
"#,
        exe = xml_escape(exe),
        user = xml_escape(user),
    )
}

fn current_user() -> Option<String> {
    let name = std::env::var("USERNAME").ok()?;
    Some(match std::env::var("USERDOMAIN") {
        Ok(domain) if !domain.is_empty() => format!("{domain}\\{name}"),
        _ => name,
    })
}

fn schtasks(args: &[&str]) -> bool {
    Command::new("schtasks.exe")
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn register_task(exe: &str) -> bool {
    let (Some(user), Some(dir)) = (current_user(), crate::app_data_dir()) else { return false };
    // schtasks wants the XML as UTF-16 LE with a BOM.
    let xml: Vec<u8> =
        std::iter::once(0xFEFF_u16).chain(task_xml(exe, &user).encode_utf16()).flat_map(u16::to_le_bytes).collect();
    let file = dir.join("autostart-task.xml");
    if std::fs::write(&file, xml).is_err() {
        return false;
    }
    let ok = schtasks(&["/Create", "/TN", AUTOSTART_NAME, "/XML", &file.to_string_lossy(), "/F"]);
    // The XML is only an input to schtasks; leaving it behind would be clutter.
    let _ = std::fs::remove_file(&file);
    ok
}

/// Turns launch-at-sign-in on. Snapshots the original state first.
pub fn enable() -> Result<Method, AutostartError> {
    snapshot::ensure()?;
    let exe = std::env::current_exe().map_err(AutostartError::Exe)?;
    let exe = exe.to_string_lossy();
    registry::set_dword(SERIALIZE_KEY, STARTUP_DELAY_VALUE, 0)?;
    if register_task(&exe) {
        // Never both: one launch path keeps sign-in clean.
        registry::delete_value(RUN_KEY, AUTOSTART_NAME)?;
        return Ok(Method::LogonTask);
    }
    registry::set_string(RUN_KEY, AUTOSTART_NAME, &format!("\"{exe}\" {AUTOSTART_ARG}"))?;
    Ok(Method::RunKey)
}

/// Turns launch-at-sign-in off and restores the original startup delay from the snapshot.
pub fn disable() -> Result<(), AutostartError> {
    // Deleting a task that does not exist fails harmlessly.
    schtasks(&["/Delete", "/TN", AUTOSTART_NAME, "/F"]);
    registry::delete_value(RUN_KEY, AUTOSTART_NAME)?;
    // No snapshot means we never changed the delay, so there is nothing to restore.
    if let Some(s) = snapshot::load() {
        match s.startup_delay_in_m_sec {
            Some(original) => registry::set_dword(SERIALIZE_KEY, STARTUP_DELAY_VALUE, original)?,
            None => registry::delete_value(SERIALIZE_KEY, STARTUP_DELAY_VALUE)?,
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_xml_escapes_paths_and_uses_normal_priority() {
        let xml = task_xml(r"C:\Apps\A&B\dotdock.exe", r"PC\user");
        assert!(xml.contains(r"<Command>C:\Apps\A&amp;B\dotdock.exe</Command>"));
        assert!(xml.contains("<Priority>4</Priority>"));
        assert!(xml.contains("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>"));
        assert!(xml.contains(&format!("<Arguments>{AUTOSTART_ARG}</Arguments>")));
    }
}
