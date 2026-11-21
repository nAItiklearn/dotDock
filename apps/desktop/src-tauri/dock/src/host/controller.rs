//! The host's own thread: a hidden window and its message loop.
//!
//! Windows tells a window about the things the dock has to react to, and a window has to be where it hears them:
//! the app bar's notifications, the broadcast that Explorer rebuilt its taskbar, a changed display or work area,
//! and the global shortcut for the App Library. The same thread owns the registered app bar and the glass plate
//! (both are tied to the thread that made them) and applies every change of settings, so there is one place where
//! "what the dock should look like" becomes "what Windows is told".
//!
//! Other threads talk to it through a channel and a wake-up message; they never touch its state.

use super::plan::{plan, Inputs, Plan};
use super::pointer::Pause;
use super::replace::{Outcome, Replacement};
use super::{window, Hooks, Styles};
use crate::appbar::{primary_monitor, work_area, AppBar};
use crate::com::{pcwstr, wide};
use crate::frozen::FrozenState;
use crate::glass::{Glass, Shape};
use crate::placement::{reserve_depth_px, window_rect, PxRect};
use crate::protocol::{DockEdge, DockSettings, EVENT_LIBRARY};
use std::cell::{Cell, RefCell};
use std::io;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, Sender};
use std::sync::Arc;
use std::thread::JoinHandle;
use windows::core::w;
use windows::Win32::Foundation::{HMODULE, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    RegisterHotKey, UnregisterHotKey, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT, VK_SPACE,
};
use windows::Win32::UI::Shell::ABN_POSCHANGED;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW, PostMessageW, PostQuitMessage,
    RegisterClassW, RegisterWindowMessageW, TranslateMessage, UnregisterClassW, MSG, SPI_SETWORKAREA, WINDOW_EX_STYLE,
    WM_APP, WM_CLOSE, WM_DESTROY, WM_DISPLAYCHANGE, WM_HOTKEY, WM_SETTINGCHANGE, WNDCLASSW, WS_EX_TOOLWINDOW, WS_POPUP,
};

const CLASS_NAME: windows::core::PCWSTR = w!("DotDockDockHost");
/// Posted to the host window when a command is waiting in the channel.
const WM_WAKE: u32 = WM_APP + 1;
/// The message the shell sends about app bars (`ABN_*` in `wParam`).
const WM_APPBAR: u32 = WM_APP + 2;
/// The App Library's shortcut: Ctrl+Alt+Space. Registered for the whole session; if another program already has it
/// the dock still works, only the shortcut does not.
const HOTKEY_ID: i32 = 1;
/// The kill switch: Ctrl+Alt+Shift+D quits dotDock and puts the Windows taskbar back, whatever state the dock is in.
const QUIT_HOTKEY_ID: i32 = 2;
const LIBRARY_ACTION: &str = "toggle";

/// One request for glass: the shapes (CSS px relative to the dock window) and whether the UI is dark.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct GlassRequest {
    pub shapes: Vec<Shape>,
    pub dark: bool,
}

/// What other threads can ask of the controller.
pub enum Command {
    Settings(DockSettings),
    Frozen(FrozenState),
    /// The dock window now exists (or is gone).
    Window(Option<isize>),
    /// The UI has asked for its first snapshot and can draw.
    UiReady,
    Glass(GlassRequest),
    /// The taskbar worker changed or refused to change the taskbar.
    Taskbar(Outcome),
    Shutdown,
}

/// A strip registered with the shell, and what it was registered for.
struct Bar {
    guard: AppBar,
    edge: DockEdge,
    asked: Option<Reservation>,
    granted: PxRect,
}

/// The inputs of one reservation; asking again with the same ones changes nothing and is skipped.
#[derive(Clone, Copy, PartialEq, Eq)]
struct Reservation {
    monitor: PxRect,
    depth: i32,
}

struct Controller {
    hwnd: HWND,
    commands: Receiver<Command>,
    hooks: Arc<dyn Hooks>,
    styles: Arc<Styles>,
    /// Set while nothing of the dock is on screen, so the cursor is not watched.
    pause: Arc<Pause>,
    settings: DockSettings,
    inputs: Inputs,
    window: Option<isize>,
    bar: Option<Bar>,
    glass: Option<Glass>,
    glass_request: GlassRequest,
    taskbar: Replacement,
    shown: bool,
    /// Where the dock window was last put, for the glass plate to follow.
    rect: Option<PxRect>,
    taskbar_created: u32,
    hotkey: bool,
}

thread_local! {
    static CONTROLLER: RefCell<Option<Controller>> = const { RefCell::new(None) };
    /// A message that needs the window placed again arrived while a call into the shell was blocking this
    /// thread (the shell sends messages to us from inside such calls). It is handled right after.
    static REPLACE_AGAIN: Cell<bool> = const { Cell::new(false) };
}

fn px(rect: RECT) -> PxRect {
    PxRect { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}

impl Controller {
    fn inputs(&self) -> Inputs {
        Inputs { window: self.window.is_some(), ..self.inputs }
    }

    fn plan(&self) -> Plan {
        plan(&self.settings, self.inputs())
    }

    fn handle(&mut self, command: Command) {
        match command {
            Command::Settings(settings) => self.settings = settings,
            Command::Frozen(frozen) => self.inputs.frozen = frozen,
            Command::Window(window) => {
                self.window = window;
                self.shown = false;
                self.rect = None;
                if let Some(window) = window {
                    self.styles.enforce(window);
                }
            }
            Command::UiReady => self.inputs.ui_ready = true,
            Command::Glass(request) => self.glass_request = request,
            Command::Taskbar(Outcome::Applied(_)) => {
                // The work area changed with the taskbar: take the strip again where the system now has room.
                self.apply(true);
                return;
            }
            Command::Taskbar(Outcome::Refused(reason)) => {
                self.hooks.log(&format!("taskbar replacement refused: {reason}"));
                self.hooks.taskbar_refused(&reason);
            }
            Command::Shutdown => {
                // SAFETY: destroys the host window on its own thread, which ends the loop in `WM_DESTROY`.
                unsafe {
                    let _ = DestroyWindow(self.hwnd);
                }
                return;
            }
        }
        self.apply(false);
    }

    /// Makes Windows match the plan. `force` asks the shell for the strip again even if nothing changed.
    fn apply(&mut self, force: bool) {
        let plan = self.plan();
        self.taskbar.want(plan.hide_taskbar);
        self.sync_bar(plan.reserve);
        self.place(force);
        self.sync_visibility(plan.visible);
    }

    fn sync_bar(&mut self, reserve: Option<DockEdge>) {
        match (reserve, &self.bar) {
            (None, _) => self.bar = None,
            (Some(edge), Some(bar)) if bar.edge == edge => {}
            (Some(edge), _) => {
                // Dropping the old registration first: the shell keeps one bar per window.
                self.bar = None;
                self.register_bar(edge);
            }
        }
    }

    fn register_bar(&mut self, edge: DockEdge) {
        let Ok(monitor) = primary_monitor() else { return };
        let depth = reserve_depth_px(self.settings.icon_size, self.scale());
        match AppBar::claim(self.hwnd.0 as isize, monitor, edge, depth, WM_APPBAR) {
            Ok(guard) => {
                let granted = px(guard.rect());
                let asked = Some(Reservation { monitor: px(monitor), depth });
                self.bar = Some(Bar { guard, edge, asked, granted });
            }
            Err(error) => self.hooks.log(&format!("app bar not registered: {error}")),
        }
    }

    fn scale(&self) -> f64 {
        self.window.map_or(1.0, window::scale)
    }

    /// Puts the window where the plan says and keeps the reserved strip right under it.
    fn place(&mut self, force: bool) {
        let (Ok(monitor), Ok(work)) = (primary_monitor(), work_area()) else { return };
        let scale = self.scale();
        let depth = reserve_depth_px(self.settings.icon_size, scale);
        let wanted = Reservation { monitor: px(monitor), depth };
        let granted = self.bar.as_mut().map(|bar| {
            if force || bar.asked != Some(wanted) {
                bar.granted = px(bar.guard.reserve(monitor, depth));
                bar.asked = Some(wanted);
            }
            bar.granted
        });
        let target = window_rect(px(monitor), px(work), self.settings.edge, granted);
        if self.rect != Some(target) || force {
            if let Some(window) = self.window {
                window::place(window, target);
            }
            self.rect = Some(target);
        }
        self.sync_glass();
    }

    fn sync_visibility(&mut self, visible: bool) {
        if let Some(window) = self.window {
            if visible != self.shown {
                if visible {
                    window::show(window);
                } else {
                    window::hide(window);
                }
                self.shown = visible;
            }
        }
        self.pause.set(!self.shown);
        self.sync_glass();
    }

    /// Draws the plate behind the reported shapes while the dock is on screen, and hides it otherwise.
    fn sync_glass(&mut self) {
        let wanted = self.shown && !self.glass_request.shapes.is_empty();
        let (Some(window), Some(rect)) = (self.window, self.rect) else { return };
        if !wanted {
            if let Some(glass) = &self.glass {
                glass.hide();
            }
            return;
        }
        if self.glass.is_none() {
            match Glass::new() {
                Ok(glass) => {
                    self.hooks.log(&format!("glass: {:?}", glass.material()));
                    self.glass = Some(glass);
                }
                Err(error) => {
                    self.hooks.log(&format!("glass not available: {error}"));
                    return;
                }
            }
        }
        if let Some(glass) = &mut self.glass {
            glass.follow(rect, window);
            let request = &self.glass_request;
            if let Err(error) = glass.show(&request.shapes, window::scale(window), request.dark) {
                self.hooks.log(&format!("glass shape refused: {error}"));
            }
        }
    }

    fn on_taskbar_created(&mut self) {
        // Explorer started again: it has forgotten every app bar and built a visible taskbar.
        self.bar = None;
        self.taskbar.rehide();
        self.apply(true);
    }

    fn drain(&mut self) {
        while let Ok(command) = self.commands.try_recv() {
            self.handle(command);
        }
    }
}

/// Runs `f` on the controller. A message that arrives while the controller is already running (from inside a
/// blocking shell call) cannot run at once; it asks for one more placement afterwards instead.
fn with_controller(f: impl FnOnce(&mut Controller), on_reentry: impl FnOnce()) {
    CONTROLLER.with(|cell| match cell.try_borrow_mut() {
        Ok(mut slot) => {
            if let Some(controller) = slot.as_mut() {
                f(controller);
                if REPLACE_AGAIN.take() {
                    controller.apply(false);
                }
            }
        }
        Err(_) => on_reentry(),
    });
}

unsafe extern "system" fn wnd_proc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match message {
        WM_WAKE => {
            with_controller(Controller::drain, || {});
            LRESULT(0)
        }
        WM_APPBAR if wparam.0 == ABN_POSCHANGED as usize => {
            with_controller(|c| c.apply(true), || REPLACE_AGAIN.set(true));
            LRESULT(0)
        }
        WM_DISPLAYCHANGE => {
            with_controller(|c| c.apply(true), || REPLACE_AGAIN.set(true));
            LRESULT(0)
        }
        WM_SETTINGCHANGE if wparam.0 == SPI_SETWORKAREA.0 as usize => {
            with_controller(|c| c.place(false), || REPLACE_AGAIN.set(true));
            LRESULT(0)
        }
        WM_HOTKEY if wparam.0 == QUIT_HOTKEY_ID as usize => {
            with_controller(|c| c.hooks.quit(), || {});
            LRESULT(0)
        }
        WM_HOTKEY if wparam.0 == HOTKEY_ID as usize => {
            with_controller(|c| c.hooks.emit(EVENT_LIBRARY, serde_json::json!(LIBRARY_ACTION)), || {});
            LRESULT(0)
        }
        WM_CLOSE => {
            // SAFETY: destroys our own window; the loop ends in WM_DESTROY.
            unsafe {
                let _ = DestroyWindow(hwnd);
            }
            LRESULT(0)
        }
        WM_DESTROY => {
            // SAFETY: ends this thread's message loop.
            unsafe { PostQuitMessage(0) };
            LRESULT(0)
        }
        _ => {
            let created =
                CONTROLLER.with(|cell| cell.try_borrow().ok().and_then(|c| c.as_ref().map(|c| c.taskbar_created)));
            if created == Some(message) {
                with_controller(Controller::on_taskbar_created, || {});
                return LRESULT(0);
            }
            // SAFETY: default handling for everything we do not act on.
            unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
        }
    }
}

/// The thread that runs the controller, and the handle other threads use to wake it.
pub struct Handle {
    tx: Sender<Command>,
    hwnd: Arc<AtomicIsize>,
    thread: Option<JoinHandle<()>>,
}

impl Handle {
    /// Starts the thread and waits until its window exists, so commands sent right away are heard.
    pub fn start(
        hooks: Arc<dyn Hooks>,
        styles: Arc<Styles>,
        pause: Arc<Pause>,
        settings: DockSettings,
    ) -> io::Result<Handle> {
        let (tx, rx) = std::sync::mpsc::channel();
        let hwnd = Arc::new(AtomicIsize::new(0));
        let published = Arc::clone(&hwnd);
        let (ready_tx, ready_rx) = sync_channel::<io::Result<()>>(1);
        let parts = Parts { commands: rx, reporter: tx.clone(), hooks, styles, pause, settings };
        let thread =
            std::thread::Builder::new().name("dock-host".into()).spawn(move || run(parts, &published, &ready_tx))?;
        ready_rx.recv().map_err(io::Error::other)??;
        Ok(Handle { tx, hwnd, thread: Some(thread) })
    }

    pub fn send(&self, command: Command) {
        if self.tx.send(command).is_ok() {
            let hwnd = self.hwnd.load(Ordering::Acquire);
            // SAFETY: wakes the host window; a window that is gone just refuses the message.
            unsafe {
                let _ = PostMessageW(Some(HWND(hwnd as *mut _)), WM_WAKE, WPARAM(0), LPARAM(0));
            }
        }
    }
}

impl Drop for Handle {
    fn drop(&mut self) {
        self.send(Command::Shutdown);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// What the thread is handed when it starts.
struct Parts {
    commands: Receiver<Command>,
    /// Where the taskbar worker reports; the same channel the commands arrive on.
    reporter: Sender<Command>,
    hooks: Arc<dyn Hooks>,
    styles: Arc<Styles>,
    pause: Arc<Pause>,
    settings: DockSettings,
}

fn run(parts: Parts, published: &AtomicIsize, ready: &std::sync::mpsc::SyncSender<io::Result<()>>) {
    let Parts { commands, reporter, hooks, styles, pause, settings } = parts;
    // SAFETY: standard window class, window and hotkey setup on this thread; each is undone below before it ends.
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
            w!("dotDock dock host"),
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
            let _ = ready.send(Err(io::Error::other("could not create the dock host window")));
            return;
        };
        published.store(hwnd.0 as isize, Ordering::Release);

        let name = wide("TaskbarCreated");
        let apply_hooks = Arc::clone(&hooks);
        let raw = hwnd.0 as isize;
        let taskbar = Replacement::start(Arc::new(move |hide| apply_hooks.set_taskbar_hidden(hide)), move |outcome| {
            // The worker is not the window thread: it reports the way every other thread does.
            if reporter.send(Command::Taskbar(outcome)).is_ok() {
                // Wakes the host window; a window that is gone just refuses the message.
                let _ = PostMessageW(Some(HWND(raw as *mut _)), WM_WAKE, WPARAM(0), LPARAM(0));
            }
        });
        let Ok(taskbar) = taskbar else {
            let _ = ready.send(Err(io::Error::other("could not start the taskbar worker")));
            let _ = DestroyWindow(hwnd);
            return;
        };
        let hotkey =
            RegisterHotKey(Some(hwnd), HOTKEY_ID, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, u32::from(VK_SPACE.0)).is_ok();
        if !hotkey {
            hooks.log("the App Library shortcut (Ctrl+Alt+Space) is taken by another program");
        }
        let quit_key = u32::from(b'D');
        if RegisterHotKey(Some(hwnd), QUIT_HOTKEY_ID, MOD_CONTROL | MOD_ALT | MOD_SHIFT | MOD_NOREPEAT, quit_key)
            .is_err()
        {
            hooks.log("the quit shortcut (Ctrl+Alt+Shift+D) is taken by another program; the tray menu still quits");
        }
        let controller = Controller {
            hwnd,
            commands,
            hooks,
            styles,
            pause,
            settings,
            inputs: Inputs::default(),
            window: None,
            bar: None,
            glass: None,
            glass_request: GlassRequest::default(),
            taskbar,
            shown: false,
            rect: None,
            taskbar_created: RegisterWindowMessageW(pcwstr(&name)),
            hotkey,
        };
        CONTROLLER.with(|cell| *cell.borrow_mut() = Some(controller));
        let _ = ready.send(Ok(()));

        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }

        // Dropping the controller removes the app bar, destroys the plate and stops the taskbar worker.
        let controller = CONTROLLER.with(|cell| cell.borrow_mut().take());
        if let Some(controller) = &controller {
            if controller.hotkey {
                let _ = UnregisterHotKey(Some(hwnd), HOTKEY_ID);
            }
            // Fails harmlessly when the shortcut was never registered.
            let _ = UnregisterHotKey(Some(hwnd), QUIT_HOTKEY_ID);
        }
        drop(controller);
        let _ = UnregisterClassW(CLASS_NAME, Some(instance.into()));
    }
}
