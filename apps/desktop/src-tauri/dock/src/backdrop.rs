//! What the dock needs to know about the glass behind it (`dock://backdrop`): whether Windows will draw the acrylic
//! (the user's "Transparency effects" switch), and whether battery saver is on, when the dock steps glass down to
//! glass-lite. The tone of the wallpaper is not measured here: `null` lets the dock follow its own light/dark mode.
//!
//! Neither setting sends a message the dock's windows receive, so a worker reads both every [`CHECK_EVERY`] and
//! emits only when one changed. Each reading is one registry value and one power-status call.

use serde::Serialize;
use std::time::Duration;
use windows::core::w;
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};

/// How often the two settings are read again.
pub const CHECK_EVERY: Duration = Duration::from_secs(15);
/// `SYSTEM_POWER_STATUS.SystemStatusFlag` while battery saver is on.
const SAVER_ON: u8 = 1;

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct DockBackdrop {
    pub available: bool,
    /// Always `None`: the dock follows its own mode (see the module comment).
    pub tone: Option<&'static str>,
    pub saver: bool,
}

/// The backdrop for a transparency setting (`None` when it cannot be read, which Windows treats as on) and a
/// power-status flag.
pub fn backdrop_of(transparency: Option<u32>, status_flag: u8) -> DockBackdrop {
    DockBackdrop { available: transparency != Some(0), tone: None, saver: status_flag == SAVER_ON }
}

fn transparency() -> Option<u32> {
    let mut value = 0u32;
    let mut size = std::mem::size_of::<u32>() as u32;
    // SAFETY: reads one DWORD into a local of that size; the key and value names are static strings.
    let read = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"),
            w!("EnableTransparency"),
            RRF_RT_REG_DWORD,
            None,
            Some((&mut value as *mut u32).cast()),
            Some(&mut size),
        )
    };
    read.is_ok().then_some(value)
}

fn status_flag() -> u8 {
    let mut status = SYSTEM_POWER_STATUS::default();
    // SAFETY: GetSystemPowerStatus only writes into the struct we own for the call.
    if unsafe { GetSystemPowerStatus(&mut status) }.is_err() {
        return 0;
    }
    status.SystemStatusFlag
}

pub fn read() -> DockBackdrop {
    backdrop_of(transparency(), status_flag())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glass_is_available_unless_transparency_is_switched_off() {
        assert!(backdrop_of(Some(1), 0).available);
        assert!(backdrop_of(None, 0).available);
        assert!(!backdrop_of(Some(0), 0).available);
    }

    #[test]
    fn battery_saver_is_the_status_flag() {
        assert!(backdrop_of(Some(1), SAVER_ON).saver);
        assert!(!backdrop_of(Some(1), 0).saver);
    }

    #[test]
    fn it_reads_as_the_dock_expects() {
        assert_eq!(
            serde_json::to_value(backdrop_of(Some(1), 0)).unwrap(),
            serde_json::json!({ "available": true, "tone": null, "saver": false })
        );
    }
}
