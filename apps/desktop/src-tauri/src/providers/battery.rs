use serde::Serialize;
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BatteryData {
    pub percent: u8,
    pub charging: bool,
    pub seconds_remaining: Option<u32>,
}

pub enum Reading {
    Present(BatteryData),
    NoBattery,
    Unavailable,
}

/// BatteryFlag bit meaning "no system battery".
const NO_SYSTEM_BATTERY: u8 = 128;
/// BatteryFlag / BatteryLifePercent value meaning "unknown".
const UNKNOWN: u8 = 255;
/// BatteryFlag bit meaning "charging".
const CHARGING: u8 = 8;
const UNKNOWN_SECONDS: u32 = u32::MAX;

pub fn read() -> Reading {
    let mut status = SYSTEM_POWER_STATUS::default();
    // SAFETY: GetSystemPowerStatus only writes into the struct we own for the call.
    if unsafe { GetSystemPowerStatus(&mut status) }.is_err() {
        return Reading::Unavailable;
    }
    if status.BatteryFlag & NO_SYSTEM_BATTERY != 0 {
        return Reading::NoBattery;
    }
    if status.BatteryLifePercent == UNKNOWN {
        return Reading::Unavailable;
    }
    let charging = status.BatteryFlag & CHARGING != 0;
    // Windows only estimates time-to-empty; time-to-full is not exposed here.
    let seconds_remaining = (!charging && status.BatteryLifeTime != UNKNOWN_SECONDS).then_some(status.BatteryLifeTime);
    Reading::Present(BatteryData { percent: status.BatteryLifePercent.min(100), charging, seconds_remaining })
}
