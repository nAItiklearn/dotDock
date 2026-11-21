//! The one thread that hears what happens on the desktop and tells the rest of the dock, without polling.
//!
//! A hidden window receives the shell hook (`RegisterShellHookWindow`), session lock and unlock
//! (`WTSRegisterSessionNotification`), display power (`GUID_CONSOLE_DISPLAY_STATE`) and the Explorer restart
//! broadcast; window events (`SetWinEventHook`, delivered through this thread's message loop) cover minimise,
//! restore, show, hide, cloak, destroy, title changes and the foreground window. Every event only marks the
//! window list dirty; a one-shot timer, armed by the first event after quiet and killed when it fires, hands the
//! worker a single `WindowsChanged`. With nothing happening there is no timer and the thread sleeps in
//! `GetMessage`.

use super::enumerate::passes_style_rules;
use crate::com::{pcwstr, wide};
use crate::frozen::{fills_monitor, Edges, FrozenState};
use std::cell::RefCell;
use std::collections::HashSet;
use std::io;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::mpsc::sync_channel;
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use windows::core::{w, GUID};
use windows::Win32::Foundation::{HANDLE, HMODULE, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Power::{
    RegisterPowerSettingNotification, UnregisterPowerSettingNotification, HPOWERNOTIFY, POWERBROADCAST_SETTING,
};
use windows::Win32::System::RemoteDesktop::{WTSRegisterSessionNotification, WTSUnRegisterSessionNotification};
use windows::Win32::System::SystemServices::GUID_CONSOLE_DISPLAY_STATE;
use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
use windows::Win32::UI::Shell::SHQueryUserNotificationState;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DeregisterShellHookWindow, DestroyWindow, DispatchMessageW, GetClassNameW,
    GetForegroundWindow, GetMessageW, GetWindowRect, GetWindowThreadProcessId, IsZoomed, KillTimer, PostMessageW,
    PostQuitMessage, RegisterClassW, RegisterShellHookWindow, RegisterWindowMessageW, SetTimer, TranslateMessage,
    UnregisterClassW, DEVICE_NOTIFY_WINDOW_HANDLE, MSG, PBT_APMRESUMEAUTOMATIC, PBT_POWERSETTINGCHANGE,
    WINDOW_EX_STYLE, WM_CLOSE, WM_DESTROY, WM_DISPLAYCHANGE, WM_POWERBROADCAST, WM_TIMER, WM_WTSSESSION_CHANGE,
    WNDCLASSW, WS_EX_TOOLWINDOW, WS_POPUP,
};

/// Quiet time after the first event before the list is recomputed, so a burst (an app opening three windows)
/// costs one recompute.
const DEBOUNCE: Duration = Duration::from_millis(40);
/// Shortest gap between two recomputes while events keep arriving, so a title that changes ten times a second
/// costs a few recomputes a second, not ten.
const MIN_GAP: Duration = Duration::from_millis(250);
const TIMER_ID: usize = 1;

// Shell hook codes (winuser.h). `HSHELL_FLASH` is `HSHELL_REDRAW | HSHELL_HIGHBIT`.
const HSHELL_HIGHBIT: usize = 0x8000;
const HSHELL_WINDOWCREATED: usize = 1;
const HSHELL_WINDOWDESTROYED: usize = 2;
const HSHELL_WINDOWACTIVATED: usize = 4;
const HSHELL_REDRAW: usize = 6;
const HSHELL_WINDOWREPLACED: usize = 13;
const HSHELL_RUDEAPPACTIVATED: usize = HSHELL_WINDOWACTIVATED | HSHELL_HIGHBIT;
const HSHELL_FLASH: usize = HSHELL_REDRAW | HSHELL_HIGHBIT;

// WinEvent ids (winuser.h).
const EVENT_SYSTEM_FOREGROUND: u32 = 0x0003;
const EVENT_SYSTEM_MINIMIZESTART: u32 = 0x0016;
const EVENT_SYSTEM_MINIMIZEEND: u32 = 0x0017;
const EVENT_OBJECT_DESTROY: u32 = 0x8001;
const EVENT_OBJECT_SHOW: u32 = 0x8002;
const EVENT_OBJECT_HIDE: u32 = 0x8003;
const EVENT_OBJECT_NAMECHANGE: u32 = 0x800C;
const EVENT_OBJECT_CLOAKED: u32 = 0x8017;
const EVENT_OBJECT_UNCLOAKED: u32 = 0x8018;
const WINEVENT_OUTOFCONTEXT: u32 = 0x0000;
const WINEVENT_SKIPOWNPROCESS: u32 = 0x0002;
/// `OBJID_WINDOW` and `CHILDID_SELF`: an event about the window itself, not one of its parts.
const OBJID_WINDOW: i32 = 0;
const CHILDID_SELF: i32 = 0;
const NOTIFY_FOR_THIS_SESSION: u32 = 0;

/// Event ranges to hook. Several narrow ranges instead of one wide one: `EVENT_OBJECT_LOCATIONCHANGE` sits
/// between destroy and name change and fires for every mouse move.
const EVENT_RANGES: [(u32, u32); 5] = [
    (EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND),
    (EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND),
    (EVENT_OBJECT_DESTROY, EVENT_OBJECT_HIDE),
    (EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_NAMECHANGE),
    (EVENT_OBJECT_CLOAKED, EVENT_OBJECT_UNCLOAKED),
];

/// What the sensors tell the dock.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Signal {
    /// Something that can change the window list happened; recompute it.
    WindowsChanged,
    /// A reason to stop (or resume) rendering changed.
    Frozen(FrozenState),
}

/// State the sensor thread and the window worker share.
#[derive(Default)]
pub struct Shared {
    /// Windows in the last list: only events about these (or about a window that could join the list) wake
    /// the worker.
    pub known: Mutex<HashSet<isize>>,
    /// Windows that asked for attention and have not been brought forward since.
    pub flashing: Mutex<HashSet<isize>>,
    pub frozen: Mutex<FrozenState>,
    /// What the sensor thread managed to register with Windows.
    pub registered: Mutex<Registrations>,
    /// Signals sent, for the measurements in the spike report.
    pub signals: std::sync::atomic::AtomicU64,
}

/// Which of the sensors' subscriptions Windows accepted. All four should be true on a normal desktop; a false
/// one means that signal never arrives (the dock then works without it, never crashes).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Registrations {
    pub shell_hook: bool,
    pub session_notifications: bool,
    pub display_power: bool,
    /// Of the five `SetWinEventHook` ranges.
    pub window_event_hooks: usize,
}

/// Window classes of the shell's own desktop and taskbar, which cover the monitor without being an app.
const SHELL_CLASSES: [&str; 3] = ["Progman", "WorkerW", "Shell_TrayWnd"];

/// Whether the foreground window is another app's full-screen window (see `frozen::fills_monitor`). dotDock's own
/// windows and the shell's desktop never count.
fn foreground_fills_monitor() -> bool {
    // SAFETY: read-only queries about the foreground window; a window that went away answers with errors or zeros.
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() {
            return false;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == std::process::id() {
            return false;
        }
        let mut class = [0u16; 64];
        let len = GetClassNameW(hwnd, &mut class);
        let class = String::from_utf16_lossy(&class[..usize::try_from(len).unwrap_or(0)]);
        if SHELL_CLASSES.contains(&class.as_str()) {
            return false;
        }
        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_err() {
            return false;
        }
        let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), &mut info).as_bool() {
            return false;
        }
        let edges = |r: RECT| Edges { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        fills_monitor(edges(rect), edges(info.rcMonitor), IsZoomed(hwnd).as_bool())
    }
}

pub fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

struct Context {
    hwnd: HWND,

    shared: Arc<Shared>,
    emit: Box<dyn Fn(Signal)>,
    timer_armed: bool,
    last_fire: Instant,
    shell_hook_message: u32,
    taskbar_created_message: u32,
}

thread_local! {
    static CONTEXT: RefCell<Option<Context>> = const { RefCell::new(None) };
}

fn with_context<R>(f: impl FnOnce(&mut Context) -> R) -> Option<R> {
    CONTEXT.with(|c| c.borrow_mut().as_mut().map(f))
}

impl Context {
    fn mark_dirty(&mut self) {
        if self.timer_armed {
            return;
        }
        let delay = DEBOUNCE.max(MIN_GAP.saturating_sub(self.last_fire.elapsed()));
        // SAFETY: a thread timer on our own window; it is killed when it fires.
        unsafe { SetTimer(Some(self.hwnd), TIMER_ID, delay.as_millis() as u32, None) };
        self.timer_armed = true;
    }

    fn fire(&mut self) {
        // SAFETY: kills the timer armed above.
        unsafe {
            let _ = KillTimer(Some(self.hwnd), TIMER_ID);
        }
        self.timer_armed = false;
        self.last_fire = Instant::now();
        self.emit(Signal::WindowsChanged);
    }

    fn emit(&self, signal: Signal) {
        self.shared.signals.fetch_add(1, Ordering::Relaxed);
        (self.emit)(signal);
    }

    fn update_frozen(&mut self, change: impl FnOnce(FrozenState) -> FrozenState) {
        let next = {
            let mut state = lock(&self.shared.frozen);
            let next = change(*state);
            if next == *state {
                return;
            }
            *state = next;
            next
        };
        self.emit(Signal::Frozen(next));
    }

    fn recheck_full_screen(&mut self) {
        // SAFETY: a plain shell query.
        if let Ok(state) = unsafe { SHQueryUserNotificationState() } {
            let fills = foreground_fills_monitor();
            self.update_frozen(|s| s.with_full_screen(state.0, fills));
        }
    }

    fn is_known(&self, hwnd: HWND) -> bool {
        lock(&self.shared.known).contains(&(hwnd.0 as isize))
    }

    fn on_win_event(&mut self, event: u32, hwnd: HWND, object: i32, child: i32) {
        if object != OBJID_WINDOW || child != CHILDID_SELF || hwnd.is_invalid() {
            return;
        }
        let known = self.is_known(hwnd);
        match event {
            EVENT_SYSTEM_FOREGROUND => {
                lock(&self.shared.flashing).remove(&(hwnd.0 as isize));
                self.recheck_full_screen();
                self.mark_dirty();
            }
            EVENT_SYSTEM_MINIMIZEEND => {
                self.recheck_full_screen();
                if known {
                    self.mark_dirty();
                }
            }
            EVENT_SYSTEM_MINIMIZESTART | EVENT_OBJECT_HIDE | EVENT_OBJECT_NAMECHANGE | EVENT_OBJECT_CLOAKED => {
                if known {
                    self.mark_dirty();
                }
            }
            EVENT_OBJECT_DESTROY => {
                if known {
                    lock(&self.shared.flashing).remove(&(hwnd.0 as isize));
                    self.mark_dirty();
                }
            }
            EVENT_OBJECT_SHOW | EVENT_OBJECT_UNCLOAKED if known || passes_style_rules(hwnd) => self.mark_dirty(),
            _ => {}
        }
    }

    fn on_shell_hook(&mut self, code: usize, target: HWND) {
        match code {
            HSHELL_FLASH => {
                lock(&self.shared.flashing).insert(target.0 as isize);
                self.mark_dirty();
            }
            HSHELL_WINDOWACTIVATED | HSHELL_RUDEAPPACTIVATED => {
                lock(&self.shared.flashing).remove(&(target.0 as isize));
                self.recheck_full_screen();
                self.mark_dirty();
            }
            HSHELL_WINDOWCREATED | HSHELL_WINDOWDESTROYED | HSHELL_WINDOWREPLACED => self.mark_dirty(),
            HSHELL_REDRAW if self.is_known(target) => self.mark_dirty(),
            _ => {}
        }
    }

    fn on_power_broadcast(&mut self, kind: usize, lparam: LPARAM) {
        if kind == PBT_POWERSETTINGCHANGE as usize {
            // SAFETY: for this notification `lparam` points at a `POWERBROADCAST_SETTING` that is valid for
            // the duration of the message; the payload is read only for the setting and length we asked for.
            unsafe {
                let setting = lparam.0 as *const POWERBROADCAST_SETTING;
                if !setting.is_null()
                    && (*setting).PowerSetting == GUID_CONSOLE_DISPLAY_STATE
                    && (*setting).DataLength == 4
                {
                    let value = std::ptr::read_unaligned((*setting).Data.as_ptr().cast::<u32>());
                    self.update_frozen(|s| s.with_display_state(value));
                }
            }
        } else if kind == PBT_APMRESUMEAUTOMATIC as usize {
            self.mark_dirty();
        }
    }
}

unsafe extern "system" fn wnd_proc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let handled = with_context(|ctx| match message {
        WM_TIMER if wparam.0 == TIMER_ID => {
            ctx.fire();
            true
        }
        WM_WTSSESSION_CHANGE => {
            let code = wparam.0 as u32;
            ctx.update_frozen(|s| s.with_session_change(code));
            ctx.mark_dirty();
            true
        }
        WM_POWERBROADCAST => {
            ctx.on_power_broadcast(wparam.0, lparam);
            true
        }
        WM_DISPLAYCHANGE => {
            ctx.recheck_full_screen();
            ctx.mark_dirty();
            true
        }
        m if m == ctx.shell_hook_message => {
            ctx.on_shell_hook(wparam.0, HWND(lparam.0 as *mut _));
            true
        }
        m if m == ctx.taskbar_created_message => {
            // Explorer restarted: its shell hook list is empty again.
            // SAFETY: re-registers our own window.
            unsafe {
                let _ = RegisterShellHookWindow(ctx.hwnd);
            }
            ctx.mark_dirty();
            true
        }
        _ => false,
    });
    match (message, handled) {
        (WM_CLOSE, _) => {
            // SAFETY: destroys our own window; the loop ends in WM_DESTROY.
            unsafe {
                let _ = DestroyWindow(hwnd);
            }
            LRESULT(0)
        }
        (WM_DESTROY, _) => {
            // SAFETY: ends this thread's message loop.
            unsafe { PostQuitMessage(0) };
            LRESULT(0)
        }
        (_, Some(true)) => LRESULT(0),
        // SAFETY: default handling for everything we do not act on.
        _ => unsafe { DefWindowProcW(hwnd, message, wparam, lparam) },
    }
}

unsafe extern "system" fn win_event_proc(
    _hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    object: i32,
    child: i32,
    _thread: u32,
    _time: u32,
) {
    with_context(|ctx| ctx.on_win_event(event, hwnd, object, child));
}

pub struct Sensors {
    hwnd: Arc<AtomicIsize>,
    thread: Option<JoinHandle<()>>,
    shared: Arc<Shared>,
}

impl Sensors {
    /// Starts the thread. `emit` runs on the sensor thread, so it must only hand the signal on (a channel send).
    pub fn start(shared: Arc<Shared>, emit: impl Fn(Signal) + Send + 'static) -> io::Result<Sensors> {
        let hwnd = Arc::new(AtomicIsize::new(0));
        let (ready_tx, ready_rx) = sync_channel::<io::Result<()>>(1);
        let thread_hwnd = Arc::clone(&hwnd);
        let thread_shared = Arc::clone(&shared);
        let thread = std::thread::Builder::new().name("dock-sensors".into()).spawn(move || {
            run(thread_shared, Box::new(emit), thread_hwnd, ready_tx);
        })?;
        ready_rx.recv().map_err(io::Error::other)??;
        Ok(Sensors { hwnd, thread: Some(thread), shared })
    }

    pub fn shared(&self) -> &Arc<Shared> {
        &self.shared
    }
}

impl Drop for Sensors {
    fn drop(&mut self) {
        let hwnd = self.hwnd.load(Ordering::SeqCst);
        if hwnd != 0 {
            // SAFETY: asks the sensor window to close itself; it ends the thread's loop.
            unsafe {
                let _ = PostMessageW(Some(HWND(hwnd as *mut _)), WM_CLOSE, WPARAM(0), LPARAM(0));
            }
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

const CLASS_NAME: windows::core::PCWSTR = w!("DotDockDockSensors");

fn run(
    shared: Arc<Shared>,
    emit: Box<dyn Fn(Signal) + Send>,
    published_hwnd: Arc<AtomicIsize>,
    ready: std::sync::mpsc::SyncSender<io::Result<()>>,
) {
    // SAFETY: standard window class, window, hook and notification setup on this thread; every registration
    // is undone below before the thread ends.
    unsafe {
        let instance: HMODULE = GetModuleHandleW(None).unwrap_or_default();
        let class = WNDCLASSW {
            lpfnWndProc: Some(wnd_proc),
            hInstance: instance.into(),
            lpszClassName: CLASS_NAME,
            ..Default::default()
        };
        RegisterClassW(&class);
        let created = CreateWindowExW(
            WINDOW_EX_STYLE(WS_EX_TOOLWINDOW.0),
            CLASS_NAME,
            w!("dotDock sensors"),
            WS_POPUP,
            0,
            0,
            0,
            0,
            None,
            None,
            Some(instance.into()),
            None,
        );
        let Ok(hwnd) = created else {
            let _ = ready.send(Err(io::Error::other("could not create the sensor window")));
            return;
        };
        published_hwnd.store(hwnd.0 as isize, Ordering::SeqCst);

        let hook_name = wide("SHELLHOOK");
        let created_name = wide("TaskbarCreated");
        let context = Context {
            hwnd,

            shared: Arc::clone(&shared),
            emit,
            timer_armed: false,
            last_fire: Instant::now(),
            shell_hook_message: RegisterWindowMessageW(pcwstr(&hook_name)),
            taskbar_created_message: RegisterWindowMessageW(pcwstr(&created_name)),
        };
        CONTEXT.with(|c| *c.borrow_mut() = Some(context));

        let shell_hook = RegisterShellHookWindow(hwnd).as_bool();
        let session = WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION).is_ok();
        let power: Option<HPOWERNOTIFY> = RegisterPowerSettingNotification(
            HANDLE(hwnd.0),
            &GUID_CONSOLE_DISPLAY_STATE as *const GUID,
            DEVICE_NOTIFY_WINDOW_HANDLE,
        )
        .ok();
        let hooks: Vec<HWINEVENTHOOK> = EVENT_RANGES
            .iter()
            .map(|(min, max)| {
                SetWinEventHook(
                    *min,
                    *max,
                    None,
                    Some(win_event_proc),
                    0,
                    0,
                    WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
                )
            })
            .collect();

        *lock(&shared.registered) = Registrations {
            shell_hook,
            session_notifications: session,
            display_power: power.is_some(),
            window_event_hooks: hooks.iter().filter(|h| !h.is_invalid()).count(),
        };
        with_context(|ctx| ctx.recheck_full_screen());
        let _ = ready.send(Ok(()));

        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }

        for hook in hooks {
            let _ = UnhookWinEvent(hook);
        }
        if let Some(power) = power {
            let _ = UnregisterPowerSettingNotification(power);
        }
        let _ = WTSUnRegisterSessionNotification(hwnd);
        let _ = DeregisterShellHookWindow(hwnd);
        let _ = UnregisterClassW(CLASS_NAME, Some(instance.into()));
        CONTEXT.with(|c| *c.borrow_mut() = None);
    }
}
