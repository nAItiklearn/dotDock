//! Global hotkeys through `RegisterHotKey`. One thread owns every registration (Windows ties a hotkey
//! to the thread that registered it) and reports presses through a callback. Bindings use the UI's
//! canonical strings, such as "Ctrl+Alt+E" (see `src/lib/shortcuts.ts`).

use serde::Serialize;
use std::sync::mpsc::{channel, Receiver, Sender};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT, MOD_WIN,
    VIRTUAL_KEY, VK_BACK, VK_DELETE, VK_DOWN, VK_END, VK_ESCAPE, VK_F1, VK_HOME, VK_INSERT, VK_LEFT, VK_NEXT, VK_OEM_1,
    VK_OEM_2, VK_OEM_3, VK_OEM_4, VK_OEM_5, VK_OEM_6, VK_OEM_7, VK_OEM_COMMA, VK_OEM_MINUS, VK_OEM_PERIOD, VK_OEM_PLUS,
    VK_PRIOR, VK_RETURN, VK_RIGHT, VK_SPACE, VK_TAB, VK_UP,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetMessageW, PeekMessageW, PostThreadMessageW, MSG, PM_NOREMOVE, WM_APP, WM_HOTKEY, WM_USER,
};

/// A parsed binding: `RegisterHotKey` modifier flags and virtual-key code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Chord {
    pub modifiers: HOT_KEY_MODIFIERS,
    pub vk: VIRTUAL_KEY,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Ok,
    /// Windows refused it: another app (or Windows itself) holds the combination.
    Conflict,
    /// Not a key combination that can be registered, or it has no modifier.
    Invalid,
}

const NAMED_KEYS: &[(&str, VIRTUAL_KEY)] = &[
    ("Escape", VK_ESCAPE),
    ("Delete", VK_DELETE),
    ("Insert", VK_INSERT),
    ("Enter", VK_RETURN),
    ("Space", VK_SPACE),
    ("Tab", VK_TAB),
    ("Backspace", VK_BACK),
    ("Home", VK_HOME),
    ("End", VK_END),
    ("PageUp", VK_PRIOR),
    ("PageDown", VK_NEXT),
    ("Up", VK_UP),
    ("Down", VK_DOWN),
    ("Left", VK_LEFT),
    ("Right", VK_RIGHT),
    (",", VK_OEM_COMMA),
    (".", VK_OEM_PERIOD),
    ("/", VK_OEM_2),
    (";", VK_OEM_1),
    ("'", VK_OEM_7),
    ("[", VK_OEM_4),
    ("]", VK_OEM_6),
    ("\\", VK_OEM_5),
    ("-", VK_OEM_MINUS),
    ("=", VK_OEM_PLUS),
    ("`", VK_OEM_3),
];

/// F1 to F24 are consecutive virtual-key codes.
const FUNCTION_KEYS: u16 = 24;

fn key(text: &str) -> Option<VIRTUAL_KEY> {
    if let Some((_, vk)) = NAMED_KEYS.iter().find(|(name, _)| *name == text) {
        return Some(*vk);
    }
    let mut chars = text.chars();
    if let (Some(c), None) = (chars.next(), chars.next()) {
        // Letters and digits are their own ASCII codes as virtual keys.
        if c.is_ascii_uppercase() || c.is_ascii_digit() {
            return Some(VIRTUAL_KEY(c as u16));
        }
    }
    let n: u16 = text.strip_prefix('F')?.parse().ok()?;
    (1..=FUNCTION_KEYS).contains(&n).then(|| VIRTUAL_KEY(VK_F1.0 + n - 1))
}

/// Parses a canonical binding. Global hotkeys need at least one modifier so they never eat typing.
pub fn parse(text: &str) -> Option<Chord> {
    let (mods, key_text) = match text.rfind('+') {
        Some(i) => (&text[..i], &text[i + 1..]),
        None => ("", text),
    };
    let mut modifiers = HOT_KEY_MODIFIERS(0);
    for part in mods.split('+').filter(|p| !p.is_empty()) {
        modifiers |= match part {
            "Ctrl" => MOD_CONTROL,
            "Alt" => MOD_ALT,
            "Shift" => MOD_SHIFT,
            "Win" => MOD_WIN,
            _ => return None,
        };
    }
    if modifiers.0 == 0 {
        return None;
    }
    Some(Chord { modifiers, vk: key(key_text)? })
}

type Bindings = Vec<(String, String)>;
type Request = (Bindings, Sender<Vec<(String, Status)>>);

/// Wakes the hotkey thread to take the next request from its channel.
const WM_REPLACE: u32 = WM_APP + 1;
/// Hotkey ids start above zero; zero is not a valid id for `RegisterHotKey`.
const FIRST_ID: i32 = 1;

pub struct Hotkeys {
    thread: u32,
    requests: Sender<Request>,
}

impl Hotkeys {
    /// Starts the hotkey thread. `on_press` gets the action name of each binding pressed.
    pub fn spawn(on_press: impl Fn(&str) + Send + 'static) -> std::io::Result<Hotkeys> {
        let (requests, inbox) = channel::<Request>();
        let (ready_tx, ready_rx) = channel::<u32>();
        std::thread::Builder::new().name("hotkeys".into()).spawn(move || run(&inbox, &ready_tx, &on_press))?;
        let thread = ready_rx.recv().map_err(|_| std::io::Error::other("hotkey thread did not start"))?;
        Ok(Hotkeys { thread, requests })
    }

    /// Replaces every registration with `bindings` (action, binding text) and reports each one.
    pub fn replace(&self, bindings: Bindings) -> Vec<(String, Status)> {
        let (reply, answer) = channel();
        if self.requests.send((bindings, reply)).is_err() {
            return Vec::new();
        }
        // SAFETY: posts a message with no pointers to the hotkey thread's own queue.
        let posted = unsafe { PostThreadMessageW(self.thread, WM_REPLACE, Default::default(), Default::default()) };
        if posted.is_err() {
            return Vec::new();
        }
        answer.recv().unwrap_or_default()
    }
}

fn run(inbox: &Receiver<Request>, ready: &Sender<u32>, on_press: &dyn Fn(&str)) {
    let mut msg = MSG::default();
    // SAFETY: creates this thread's message queue before anyone posts to it, then reports the thread id.
    unsafe {
        let _ = PeekMessageW(&mut msg, None, WM_USER, WM_USER, PM_NOREMOVE);
        let _ = ready.send(GetCurrentThreadId());
    }
    let mut registered: Vec<Option<String>> = Vec::new();
    // SAFETY: standard message loop on this thread; GetMessageW returns 0 on WM_QUIT and -1 on error.
    while unsafe { GetMessageW(&mut msg, None, 0, 0) }.0 > 0 {
        match msg.message {
            WM_HOTKEY => {
                let index = i32::try_from(msg.wParam.0).ok().and_then(|id| usize::try_from(id - FIRST_ID).ok());
                if let Some(Some(action)) = index.and_then(|i| registered.get(i)) {
                    on_press(action);
                }
            }
            WM_REPLACE => {
                while let Ok((bindings, reply)) = inbox.try_recv() {
                    unregister_all(registered.len());
                    let (now, statuses) = register_all(&bindings);
                    registered = now;
                    let _ = reply.send(statuses);
                }
            }
            _ => {}
        }
    }
}

fn hotkey_id(index: usize) -> i32 {
    FIRST_ID + i32::try_from(index).unwrap_or(i32::MAX - FIRST_ID)
}

fn unregister_all(count: usize) {
    for index in 0..count {
        // SAFETY: unregisters a thread-level hotkey; failure only means it was never registered.
        unsafe {
            let _ = UnregisterHotKey(None, hotkey_id(index));
        }
    }
}

/// Registers each binding under its index. A failed one is kept as None so ids stay aligned.
fn register_all(bindings: &[(String, String)]) -> (Vec<Option<String>>, Vec<(String, Status)>) {
    bindings
        .iter()
        .enumerate()
        .map(|(index, (action, text))| {
            let Some(chord) = parse(text) else { return (None, (action.clone(), Status::Invalid)) };
            // SAFETY: thread-level registration (no window); MOD_NOREPEAT stops a held key repeating.
            let ok = unsafe {
                RegisterHotKey(None, hotkey_id(index), chord.modifiers | MOD_NOREPEAT, u32::from(chord.vk.0))
            };
            match ok {
                Ok(()) => (Some(action.clone()), (action.clone(), Status::Ok)),
                Err(_) => (None, (action.clone(), Status::Conflict)),
            }
        })
        .unzip()
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::UI::Input::KeyboardAndMouse::{VK_F24, VK_F5};

    #[test]
    fn parses_the_default_bindings() {
        assert_eq!(
            parse("Ctrl+Alt+E"),
            Some(Chord { modifiers: MOD_CONTROL | MOD_ALT, vk: VIRTUAL_KEY(u16::from(b'E')) })
        );
        assert_eq!(parse("Win+F5").map(|c| c.vk), Some(VK_F5));
        assert_eq!(parse("Ctrl+Shift+Left").map(|c| c.vk), Some(VK_LEFT));
        assert_eq!(parse("Ctrl+Alt+/").map(|c| c.vk), Some(VK_OEM_2));
        assert_eq!(parse("Alt+F24").map(|c| c.vk), Some(VK_F24));
    }

    #[test]
    fn rejects_what_cannot_be_a_global_hotkey() {
        assert_eq!(parse("E"), None, "no modifier");
        assert_eq!(parse("Ctrl+Hyper+E"), None, "unknown modifier");
        assert_eq!(parse("Ctrl+F25"), None);
        assert_eq!(parse("Ctrl+banana"), None);
        assert_eq!(parse(""), None);
    }

    #[test]
    fn a_hotkey_really_registers_and_a_taken_one_is_a_conflict() {
        let hotkeys = Hotkeys::spawn(|_| {}).expect("thread starts");
        // Unusual chords, so the test never collides with the running app or the desktop.
        let out =
            hotkeys.replace(vec![("probe".into(), "Ctrl+Alt+Shift+F23".into()), ("broken".into(), "nonsense".into())]);
        assert_eq!(out, vec![("probe".into(), Status::Ok), ("broken".into(), Status::Invalid)]);
        let out = hotkeys
            .replace(vec![("one".into(), "Ctrl+Alt+Shift+F22".into()), ("two".into(), "Ctrl+Alt+Shift+F22".into())]);
        assert_eq!(out, vec![("one".into(), Status::Ok), ("two".into(), Status::Conflict)]);
        // Replacing releases the old ones: F23 is free again for another registrar.
        let other = Hotkeys::spawn(|_| {}).expect("second thread");
        assert_eq!(other.replace(vec![("again".into(), "Ctrl+Alt+Shift+F23".into())])[0].1, Status::Ok);
        assert!(hotkeys.replace(Vec::new()).is_empty());
    }
}
