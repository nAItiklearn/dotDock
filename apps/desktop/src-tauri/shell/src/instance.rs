//! Which launch of dotDock is the running app. Every later launch (a second click on the shortcut, a
//! "open Settings" that starts the exe again) only hands over to the running app and exits. It must do
//! nothing on the way: no crash-guard count, no boot-log start, no taskbar recovery. Counting those
//! launches as crashed starts tripped the crash guard after three of them, which restored the Windows
//! desktop under the running app.

use std::sync::OnceLock;
use windows::core::HSTRING;
use windows::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS};
use windows::Win32::System::Threading::CreateMutexW;

/// Session-local name, the same for every launch of this user's dotDock.
const NAME: &str = r"Local\dev.dotdock.desktop.instance";

static PRIMARY: OnceLock<bool> = OnceLock::new();

/// True in the launch that runs the app; false in a later one while the first is alive. Decided once.
pub fn is_primary() -> bool {
    *PRIMARY.get_or_init(|| claim(NAME))
}

/// Takes the named mutex: true when this process is its first holder. The winning handle is never
/// closed, so the mutex lives exactly as long as this process. When the mutex cannot be created at
/// all this launch counts as the running app, so a broken mutex never stops dotDock starting.
fn claim(name: &str) -> bool {
    // SAFETY: owned wide string; no security attributes; the last error is read right after the call.
    let created =
        unsafe { CreateMutexW(None, false, &HSTRING::from(name)).map(|h| (h, GetLastError() == ERROR_ALREADY_EXISTS)) };
    match created {
        Ok((theirs, true)) => {
            // SAFETY: this launch's own handle to the other holder's mutex, closed once and not used again.
            let _ = unsafe { CloseHandle(theirs) };
            false
        }
        Ok((_, false)) | Err(_) => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique(tag: &str) -> String {
        format!(r"Local\dev.dotdock.desktop.instance-test-{tag}-{}", std::process::id())
    }

    #[test]
    fn a_second_launch_while_the_first_runs_is_not_the_running_app() {
        let name = unique("second");
        assert!(claim(&name));
        assert!(!claim(&name));
        assert!(!claim(&name), "every later launch hands over, not just the second");
    }

    #[test]
    fn the_first_launch_of_a_fresh_session_is_the_running_app() {
        assert!(claim(&unique("fresh")));
    }

    #[test]
    fn the_decision_is_made_once() {
        assert_eq!(is_primary(), is_primary());
    }
}
