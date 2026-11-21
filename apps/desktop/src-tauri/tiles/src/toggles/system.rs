//! Night light and Do Not Disturb: read-only.
//!
//! Windows has no documented way to switch either one, so the tile shows the state and opens the Settings page.
//! Both states are read from values the shell itself writes under `HKCU`; decision D-020 records why and what
//! happens when a Windows update changes the layout (the toggle then reports "unknown", never a guess).

use crate::protocol::{SettingsPage, Toggle};
use crate::registry;

pub const NIGHT_LIGHT_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\DefaultAccount\Current\default$windows.data.bluelightreduction.bluelightreductionstate\windows.data.bluelightreduction.bluelightreductionstate";
const NIGHT_LIGHT_VALUE: &str = "Data";
/// Byte of the night light state blob that holds the on/off marker.
const NIGHT_LIGHT_MARKER_AT: usize = 18;
const NIGHT_LIGHT_ON: u8 = 0x15;
const NIGHT_LIGHT_OFF: u8 = 0x13;

pub const NOTIFICATION_SETTINGS_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Notifications\Settings";
/// Written as 0 by the Do Not Disturb switch in the notification centre; absent while notifications are on.
const TOASTS_ENABLED_VALUE: &str = "NOC_GLOBAL_SETTING_TOASTS_ENABLED";

/// Interprets the night light state blob; None when its layout is not the one we know.
fn parse_night_light(blob: &[u8]) -> Option<bool> {
    match *blob.get(NIGHT_LIGHT_MARKER_AT)? {
        NIGHT_LIGHT_ON => Some(true),
        NIGHT_LIGHT_OFF => Some(false),
        _ => None,
    }
}

pub fn night_light() -> Toggle {
    match registry::read_binary(NIGHT_LIGHT_KEY, NIGHT_LIGHT_VALUE) {
        // A profile that never touched night light has no state blob: it is off.
        None => Toggle { available: true, on: Some(false), problem: None },
        Some(blob) => match parse_night_light(&blob) {
            Some(on) => Toggle { available: true, on: Some(on), problem: None },
            None => Toggle {
                available: true,
                on: None,
                problem: Some("This Windows version stores night light differently".to_owned()),
            },
        },
    }
}

pub fn do_not_disturb() -> Toggle {
    let on = registry::read_dword(NOTIFICATION_SETTINGS_KEY, TOASTS_ENABLED_VALUE) == Some(0);
    Toggle { available: true, on: Some(on), problem: None }
}

pub fn settings_uri(page: SettingsPage) -> &'static str {
    match page {
        SettingsPage::NightLight => "ms-settings:nightlight",
        SettingsPage::DoNotDisturb => "ms-settings:notifications",
        SettingsPage::Sound => "ms-settings:sound",
        SettingsPage::Bluetooth => "ms-settings:bluetooth",
        SettingsPage::Wifi => "ms-settings:network-wifi",
        SettingsPage::Display => "ms-settings:display",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blob(marker: u8) -> Vec<u8> {
        let mut b = vec![0u8; 24];
        b[NIGHT_LIGHT_MARKER_AT] = marker;
        b
    }

    #[test]
    fn night_light_marker_is_read() {
        assert_eq!(parse_night_light(&blob(NIGHT_LIGHT_ON)), Some(true));
        assert_eq!(parse_night_light(&blob(NIGHT_LIGHT_OFF)), Some(false));
        assert_eq!(parse_night_light(&blob(0x42)), None);
        assert_eq!(parse_night_light(&[0u8; 4]), None);
    }

    #[test]
    fn every_page_has_a_settings_uri() {
        for page in [
            SettingsPage::NightLight,
            SettingsPage::DoNotDisturb,
            SettingsPage::Sound,
            SettingsPage::Bluetooth,
            SettingsPage::Wifi,
            SettingsPage::Display,
        ] {
            assert!(crate::shell::is_allowed_uri(settings_uri(page)));
        }
    }
}
