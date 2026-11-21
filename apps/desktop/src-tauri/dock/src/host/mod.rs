//! The dock window's host, minus the UI framework: what turns settings into a window on the screen.
//!
//! - `plan`: what should be true for a set of settings (show, reserve a strip, hide the taskbar).
//! - `controller`: the thread that makes it true: a hidden window that hears the app bar, Explorer's restart, display
//!   changes and the App Library shortcut, and owns the registered bar.
//! - `replace`: hides and restores the Windows taskbar off the dock's way.
//! - `pointer`, `window`: click-through with a cursor that is read, never hooked, and the window's Win32 styles.
//!
//! The application supplies a `Hooks` for the four things only it can do (talk to the dock UI, write the log, hide
//! the taskbar through its restore guard, and give up on hiding it) and the window itself (`attach`).

mod controller;
pub mod plan;
pub mod pointer;
pub mod replace;
pub mod window;

use crate::frozen::FrozenState;
use crate::protocol::{DockSettings, Rect, EVENT_POINTER};
use controller::{Command, Handle};
use pointer::{Pause, Poller, Regions};
use std::io;
use std::sync::{Arc, Mutex, PoisonError};
use window::{DockCursor, Focus};

pub use window::Styles;

/// What only the application can do for the host.
pub trait Hooks: Send + Sync + 'static {
    /// Sends an event to the dock window.
    fn emit(&self, event: &str, payload: serde_json::Value);
    /// Writes a line to the application's log.
    fn log(&self, line: &str);
    /// Hides (`true`) or restores (`false`) the Windows taskbar, through the application's restore guard. `Err` means
    /// nothing was changed.
    fn set_taskbar_hidden(&self, hidden: bool) -> Result<(), String>;
    /// Hiding the taskbar was refused: the setting should go back to off.
    fn taskbar_refused(&self, reason: &str);
    /// The kill switch (Ctrl+Alt+Shift+D) was pressed: quit now, putting the Windows taskbar back.
    fn quit(&self);
}

/// The dock window and what the host knows about it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WindowMetrics {
    pub window: isize,
    /// DPI scale factor (1.25 at 125 %).
    pub scale: f64,
    /// Client width in physical px.
    pub width_px: i32,
}

struct Attached {
    window: isize,
    poller: Poller,
}

/// Held by the application for as long as the dock exists. `shutdown` (or dropping it) removes the app bar and the
/// and stops every thread; it does not restore the taskbar, which the application's exit path does
/// through its guard.
pub struct DockHost {
    hooks: Arc<dyn Hooks>,
    styles: Arc<Styles>,
    regions: Arc<Regions>,
    pause: Arc<Pause>,
    focus: Focus,
    attached: Mutex<Option<Attached>>,
    /// `None` after `shutdown`; commands then go nowhere.
    controller: Mutex<Option<Handle>>,
}

impl DockHost {
    /// Starts the host thread. Nothing is shown, reserved or hidden until a window is attached and the UI is ready.
    pub fn start(hooks: Arc<dyn Hooks>, settings: DockSettings) -> io::Result<DockHost> {
        let styles = Arc::new(Styles::default());
        let pause = Arc::new(Pause::default());
        pause.set(true);
        let controller = Handle::start(Arc::clone(&hooks), Arc::clone(&styles), Arc::clone(&pause), settings)?;
        Ok(DockHost {
            hooks,
            styles,
            regions: Arc::new(Regions::default()),
            pause,
            focus: Focus::default(),
            attached: Mutex::new(None),
            controller: Mutex::new(Some(controller)),
        })
    }

    fn attached(&self) -> std::sync::MutexGuard<'_, Option<Attached>> {
        self.attached.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn send(&self, command: Command) {
        if let Some(controller) = &*self.controller.lock().unwrap_or_else(PoisonError::into_inner) {
            controller.send(command);
        }
    }

    /// Removes the app bar and stops the host's threads, waiting for each. Safe to call twice.
    pub fn shutdown(&self) {
        *self.attached() = None;
        // Taken out of the lock first: stopping the thread can take a moment and must not block `send`.
        let controller = self.controller.lock().unwrap_or_else(PoisonError::into_inner).take();
        drop(controller);
    }

    /// The dock window exists. It is made click-through and unfocusable at once; it is shown when the plan says so.
    pub fn attach(&self, window: isize) -> io::Result<()> {
        let hooks = Arc::clone(&self.hooks);
        let poller = Poller::start(
            DockCursor::new(window, Arc::clone(&self.styles)),
            Arc::clone(&self.regions),
            Arc::clone(&self.pause),
            move |inside| hooks.emit(EVENT_POINTER, serde_json::json!({ "inside": inside })),
        )?;
        *self.attached() = Some(Attached { window, poller });
        self.send(Command::Window(Some(window)));
        Ok(())
    }

    /// The dock window is gone.
    pub fn detach(&self) {
        *self.attached() = None;
        self.send(Command::Window(None));
    }

    pub fn settings(&self, settings: DockSettings) {
        self.send(Command::Settings(settings));
    }

    pub fn frozen(&self, state: FrozenState) {
        self.send(Command::Frozen(state));
    }

    /// The UI asked for its first snapshot, so the dock can appear.
    pub fn ui_ready(&self) {
        self.send(Command::UiReady);
    }

    /// The rectangles that take the pointer (CSS px relative to the window).
    pub fn set_regions(&self, rects: Vec<Rect>) {
        self.regions.replace(rects);
        if let Some(attached) = &*self.attached() {
            attached.poller.wake();
        }
    }

    /// The dock needs the keyboard (`true`) or is done with it (`false`).
    pub fn set_focus(&self, active: bool) {
        let Some(window) = self.attached().as_ref().map(|a| a.window) else { return };
        if active {
            self.focus.take(window, &self.styles);
        } else {
            self.focus.give_back(window, &self.styles);
        }
    }

    /// The window's handle, scale and width, for DWM thumbnails.
    pub fn metrics(&self) -> Option<WindowMetrics> {
        let window = self.attached().as_ref().map(|a| a.window)?;
        window::exists(window).then(|| WindowMetrics {
            window,
            scale: window::scale(window),
            width_px: window::client_width(window),
        })
    }
}
