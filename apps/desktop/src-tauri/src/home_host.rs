//! The home screen as a module: the desktop overlay window, the thread that keeps it at desktop
//! level, and the providers that feed it. `Home` starts all of it and stops all of it at run time.
//!
//! Stopping stops the run gate every thread sleeps on, waits for each thread, then destroys the
//! window, so nothing of the home screen is left. The boot-stage marks are written only for the
//! first start of the process; later starts are not boot.

use crate::desktop_host::{self, HitRect, HitRegions, Hwnd};
use crate::{lifecycle, providers};
use dotdock_shell::boot_log as boot;
use dotdock_shell::modules::Lifecycle;
use dotdock_shell::run_gate::RunGate;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, PoisonError};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub(crate) const OVERLAY_LABEL: &str = "overlay";
/// If the UI never reports its first frame, show the window anyway rather than stay invisible.
const SHOW_FALLBACK: Duration = Duration::from_secs(3);

/// False until the overlay has been shown once; boot stages are only recorded until then.
static BOOTED: AtomicBool = AtomicBool::new(false);

fn boot_mark(stage: &str) {
    if !BOOTED.load(Ordering::Acquire) {
        boot::mark(stage);
    }
}

/// Managed state: the gate of the running home screen, or nothing while it is off. Commands from the
/// overlay reach its threads through it.
#[derive(Default)]
pub struct HomeState(Mutex<Option<RunGate>>);

impl HomeState {
    fn gate(&self) -> Option<RunGate> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }

    fn set(&self, gate: Option<RunGate>) {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = gate;
    }

    /// Wakes the weather thread now, e.g. after the user picks a new place.
    pub fn wake_weather(&self) {
        if let Some(gate) = self.gate() {
            gate.nudge();
        }
    }
}

/// Called by the overlay once its listeners exist; providers replay current values.
#[tauri::command]
pub fn providers_ready(home: State<'_, HomeState>) {
    boot_mark("providers-ready");
    if let Some(gate) = home.gate() {
        gate.open();
    }
}

/// Called after the first fully rendered frame (fonts loaded, cached data drawn).
#[tauri::command]
pub fn overlay_ready(app: AppHandle) {
    boot_mark("overlay-ready");
    show_overlay(&app);
}

/// A widget text field gained (`true`) or lost focus.
#[tauri::command]
pub fn overlay_set_typing(app: AppHandle, typing: bool) {
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else { return };
    if let Ok(hwnd) = window.hwnd() {
        desktop_host::set_typing(Hwnd::from_raw(hwnd.0), typing);
    }
}

#[tauri::command]
pub fn set_hit_regions(rects: Vec<HitRect>, regions: State<'_, HitRegions>) {
    regions.replace(rects);
}

fn show_overlay(app: &AppHandle) {
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else { return };
    if window.is_visible().unwrap_or(false) {
        return;
    }
    let Ok(hwnd) = window.hwnd() else { return };
    // Never steal focus from what the user is doing when the widgets appear.
    if desktop_host::show_without_activating(Hwnd::from_raw(hwnd.0)) {
        boot_mark("shown");
        BOOTED.store(true, Ordering::Release);
    }
}

fn create_overlay(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    // Size and position come from Win32 in desktop_host (and are re-fitted on display changes).
    let window = WebviewWindowBuilder::new(app, OVERLAY_LABEL, WebviewUrl::App("overlay.html".into()))
        .title("Desktop")
        .visible(false)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .additional_browser_args(
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required",
        )
        .always_on_bottom(true)
        // Lets a photo dragged from Explorer reach the page (the photo widget's drop zone).
        .disable_drag_drop_handler()
        .build()?;
    desktop_host::configure(Hwnd::from_raw(window.hwnd()?.0));
    Ok(window)
}

/// Everything the running home screen owns besides its window.
struct Running {
    gate: RunGate,
    threads: Vec<JoinHandle<()>>,
}

impl Running {
    /// Stops the gate, waits for every thread, then closes the window.
    fn shut_down(self, app: &AppHandle) {
        self.gate.stop();
        self.threads.into_iter().for_each(lifecycle::join);
        lifecycle::destroy_window(app, OVERLAY_LABEL);
    }
}

/// The home screen, plugged into the module manager.
pub struct Home {
    app: AppHandle,
    running: Option<Running>,
}

impl Home {
    pub fn new(app: AppHandle) -> Self {
        Self { app, running: None }
    }

    /// Spawns the threads of a home screen whose window exists. On error the caller shuts down `run`.
    fn spawn_threads(&self, window: &WebviewWindow, run: &mut Running) -> Result<(), String> {
        let hwnd = Hwnd::from_raw(window.hwnd().map_err(|e| e.to_string())?.0);
        boot_mark("window-created");
        let regions = self.app.state::<HitRegions>().inner().clone();
        providers::spawn(&self.app, &run.gate, &mut run.threads).map_err(|e| e.to_string())?;
        run.threads.push(desktop_host::spawn_guard(hwnd, regions, run.gate.clone()).map_err(|e| e.to_string())?);
        let (app, gate) = (self.app.clone(), run.gate.clone());
        let fallback = thread::Builder::new()
            .name("overlay-fallback".into())
            .spawn(move || {
                if !gate.pause(SHOW_FALLBACK) {
                    return;
                }
                if app.get_webview_window(OVERLAY_LABEL).is_some_and(|w| !w.is_visible().unwrap_or(true)) {
                    boot_mark("show-fallback");
                }
                show_overlay(&app);
            })
            .map_err(|e| e.to_string())?;
        run.threads.push(fallback);
        Ok(())
    }
}

impl Lifecycle for Home {
    fn start(&mut self) -> Result<(), String> {
        // The gate is in place before the page exists: a warm webview can report its listeners ready
        // before the window builder returns, and that call must find the gate to open it.
        let mut run = Running { gate: RunGate::default(), threads: Vec::new() };
        self.app.state::<HomeState>().set(Some(run.gate.clone()));
        let window = match create_overlay(&self.app) {
            Ok(window) => window,
            Err(e) => {
                self.app.state::<HomeState>().set(None);
                return Err(format!("The desktop window could not be created: {e}"));
            }
        };
        if let Err(reason) = self.spawn_threads(&window, &mut run) {
            self.app.state::<HomeState>().set(None);
            run.shut_down(&self.app);
            return Err(reason);
        }
        self.running = Some(run);
        Ok(())
    }

    fn stop(&mut self) {
        self.app.state::<HomeState>().set(None);
        // Hit areas belong to the window that is going away; the next one reports its own.
        self.app.state::<HitRegions>().replace(Vec::new());
        if let Some(run) = self.running.take() {
            run.shut_down(&self.app);
        }
    }
}
