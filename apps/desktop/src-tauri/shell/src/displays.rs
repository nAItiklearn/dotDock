//! Facts about a display that Tauri's monitor list does not carry: a name a person recognises and
//! the refresh rate.

use windows::core::HSTRING;
use windows::Win32::Graphics::Gdi::{EnumDisplaySettingsW, DEVMODEW, ENUM_CURRENT_SETTINGS};

/// `\\.\DISPLAY2` is "Display 2" to a person, as in Windows Settings.
pub fn label(device: &str) -> String {
    device
        .rsplit("DISPLAY")
        .next()
        .filter(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
        .map_or_else(|| device.to_owned(), |n| format!("Display {n}"))
}

/// Windows reports 0 or 1 when the rate is the hardware default it cannot name.
const UNKNOWN_RATE: u32 = 1;

/// The current refresh rate of a display device, in Hz.
pub fn refresh_hz(device: &str) -> Option<u32> {
    let mut mode = DEVMODEW { dmSize: u16::try_from(std::mem::size_of::<DEVMODEW>()).ok()?, ..Default::default() };
    // SAFETY: DEVMODEW is sized as the API requires and the device name outlives the call.
    let ok = unsafe { EnumDisplaySettingsW(&HSTRING::from(device), ENUM_CURRENT_SETTINGS, &mut mode) };
    (ok.as_bool() && mode.dmDisplayFrequency > UNKNOWN_RATE).then_some(mode.dmDisplayFrequency)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_names_read_like_windows_settings() {
        assert_eq!(label(r"\\.\DISPLAY1"), "Display 1");
        assert_eq!(label(r"\\.\DISPLAY12"), "Display 12");
        assert_eq!(label("Built-in"), "Built-in");
    }

    #[test]
    fn an_unknown_device_has_no_rate() {
        assert_eq!(refresh_hz(r"\\.\NOT-A-DISPLAY"), None);
    }
}
