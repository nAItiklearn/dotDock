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
const ALLOWED_SCHEMES: [&str; 12] = [
    "ms-screenclip:",
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

/// True for an `http:` or `https:` address with a host and nothing a shell could read as more than one argument.
pub fn is_web_address(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    let rest = lower.strip_prefix("https://").or_else(|| lower.strip_prefix("http://"));
    rest.is_some_and(|rest| !rest.is_empty() && !rest.starts_with('/'))
        && !url.chars().any(|c| c.is_control() || c.is_whitespace() || c == '"')
}

/// Opens a web address in the default browser, and nothing else.
pub fn open_web(url: &str) -> Result<(), String> {
    if !is_web_address(url) {
        return Err("that is not a web address".to_owned());
    }
    open(url)
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
    fn a_web_address_is_http_or_https_with_a_host_and_nothing_else() {
        assert!(is_web_address("https://duckduckgo.com/?q=dot+dock"));
        assert!(is_web_address("HTTP://example.org"));
        assert!(!is_web_address("https://"));
        assert!(!is_web_address("https:///etc"));
        assert!(!is_web_address("file:///C:/Windows/notepad.exe"));
        assert!(!is_web_address("ms-settings:display"));
        assert!(!is_web_address("https://example.org \"&calc"));
        assert!(!is_web_address("https://exa\nmple.org"));
    }

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
