//! Which clipboard contents may be recorded. Password managers and other sensitive sources mark their copies with
//! one of three conventions, and a marked copy is never read, stored or shown.

/// What the clipboard owner declared about the content, from the registered formats on the clipboard.
#[derive(Default, Clone, Copy, PartialEq, Eq, Debug)]
pub struct Signals {
    /// `ExcludeClipboardContentFromMonitorProcessing` is present: the owner asks every monitor to ignore the copy.
    pub exclude_from_monitor: bool,
    /// `Clipboard Viewer Ignore` is present: the older convention password managers still set.
    pub viewer_ignore: bool,
    /// `CanIncludeInClipboardHistory` holds this DWORD (0 = keep out of history, 1 = allowed), when present.
    pub include_in_history: Option<u32>,
}

/// True when the copy may be recorded.
pub fn allows_recording(signals: Signals) -> bool {
    !signals.exclude_from_monitor && !signals.viewer_ignore && signals.include_in_history != Some(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_ordinary_copy_is_recorded() {
        assert!(allows_recording(Signals::default()));
        assert!(allows_recording(Signals { include_in_history: Some(1), ..Default::default() }));
    }

    #[test]
    fn each_privacy_convention_blocks_recording() {
        assert!(!allows_recording(Signals { exclude_from_monitor: true, ..Default::default() }));
        assert!(!allows_recording(Signals { viewer_ignore: true, ..Default::default() }));
        assert!(!allows_recording(Signals { include_in_history: Some(0), ..Default::default() }));
    }
}
