//! Opening things the way Explorer would: files, links, Settings pages, "show in folder".

use crate::com::wide;
use std::path::Path;
use windows::core::PCWSTR;
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

/// `ShellExecuteW` returns a value above 32 when it worked.
const SHELL_EXECUTE_OK: usize = 32;

fn execute(verb: &str, target: &str, params: Option<&str>) -> Result<(), String> {
    let verb_w = wide(verb);
    let target_w = wide(target);
    let params_w = params.map(wide);
    // SAFETY: all strings are NUL-terminated and outlive the call.
    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(verb_w.as_ptr()),
            PCWSTR(target_w.as_ptr()),
            params_w.as_ref().map_or(PCWSTR::null(), |p| PCWSTR(p.as_ptr())),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if result.0 as usize > SHELL_EXECUTE_OK {
        Ok(())
    } else {
        Err(format!("Windows could not open {target} (code {})", result.0 as usize))
    }
}

/// Opens a file, folder or URI with its default handler.
pub fn open(target: &str) -> Result<(), String> {
    execute("open", target, None)
}

/// Opens Explorer with the file selected.
pub fn reveal(path: &Path) -> Result<(), String> {
    let arg = format!("/select,\"{}\"", path.display());
    execute("open", "explorer.exe", Some(&arg))
}

/// Schemes the dock itself ever asks Windows to launch. Anything else from the UI is refused.
const ALLOWED_SCHEMES: [&str; 11] = [
    "https:",
    "http:",
    "tel:",
    "sms:",
    "mailto:",
    "msteams:",
    "zoommtg:",
    "zoomus:",
    "whatsapp:",
    "discord:",
    "ms-settings:",
];

/// True when `uri` starts with one of the schemes above.
pub fn is_allowed_uri(uri: &str) -> bool {
    let lower = uri.trim().to_ascii_lowercase();
    ALLOWED_SCHEMES.iter().any(|s| lower.starts_with(s)) && !lower.chars().any(char::is_control)
}

/// Opens a link, after checking its scheme.
pub fn open_uri(uri: &str) -> Result<(), String> {
    if !is_allowed_uri(uri) {
        return Err("that link type is not allowed".to_owned());
    }
    open(uri.trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_schemes_are_opened() {
        assert!(is_allowed_uri("https://teams.microsoft.com/l/meetup-join/abc"));
        assert!(is_allowed_uri("  TEL:+15551234567"));
        assert!(is_allowed_uri("ms-settings:nightlight"));
        assert!(!is_allowed_uri("file:///C:/Windows/System32/cmd.exe"));
        assert!(!is_allowed_uri("javascript:alert(1)"));
        assert!(!is_allowed_uri("C:\\Windows\\notepad.exe"));
        assert!(!is_allowed_uri("https://example.com/\u{7}"));
    }
}
