use serde::Serialize;
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BatteryData {
    pub percent: u8,
    /// The battery is actually taking charge.
    pub charging: bool,
    /// On AC power. Can be true while not charging: full, or a charge limit such as
    /// Lenovo's conservation mode. The UI shows "Plugged in" for that case.
    pub plugged_in: bool,
    /// Seconds until empty; Windows does not expose time-to-full here, so None while on AC.
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
/// ACLineStatus value meaning "online".
const AC_ONLINE: u8 = 1;
const UNKNOWN_SECONDS: u32 = u32::MAX;

fn interpret(status: &SYSTEM_POWER_STATUS) -> Reading {
    if status.BatteryFlag != UNKNOWN && status.BatteryFlag & NO_SYSTEM_BATTERY != 0 {
        return Reading::NoBattery;
    }
    if status.BatteryLifePercent == UNKNOWN {
        return Reading::Unavailable;
    }
    let plugged_in = status.ACLineStatus == AC_ONLINE;
    let charging = status.BatteryFlag != UNKNOWN && status.BatteryFlag & CHARGING != 0;
    let seconds_remaining =
        (!plugged_in && status.BatteryLifeTime != UNKNOWN_SECONDS).then_some(status.BatteryLifeTime);
    Reading::Present(BatteryData {
        percent: status.BatteryLifePercent.min(100),
        charging,
        plugged_in,
        seconds_remaining,
    })
}

pub fn read() -> Reading {
    let mut status = SYSTEM_POWER_STATUS::default();
    // SAFETY: GetSystemPowerStatus only writes into the struct we own for the call.
    if unsafe { GetSystemPowerStatus(&mut status) }.is_err() {
        return Reading::Unavailable;
    }
    interpret(&status)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn status(ac: u8, flag: u8, percent: u8, life: u32) -> SYSTEM_POWER_STATUS {
        SYSTEM_POWER_STATUS {
            ACLineStatus: ac,
            BatteryFlag: flag,
            BatteryLifePercent: percent,
            BatteryLifeTime: life,
            ..Default::default()
        }
    }

    #[test]
    fn plugged_in_at_a_charge_limit_is_not_on_battery() {
        let Reading::Present(d) = interpret(&status(AC_ONLINE, 1, 80, UNKNOWN_SECONDS)) else {
            panic!("expected a battery reading")
        };
        assert!(d.plugged_in && !d.charging);
        assert_eq!(d.seconds_remaining, None);
    }

    #[test]
    fn discharging_reports_time_left() {
        let Reading::Present(d) = interpret(&status(0, 0, 50, 3600)) else { panic!("expected a battery reading") };
        assert!(!d.plugged_in && !d.charging);
        assert_eq!(d.seconds_remaining, Some(3600));
    }

    #[test]
    fn desktop_without_battery_is_reported_as_such() {
        assert!(matches!(
            interpret(&status(AC_ONLINE, NO_SYSTEM_BATTERY, UNKNOWN, UNKNOWN_SECONDS)),
            Reading::NoBattery
        ));
    }
}
