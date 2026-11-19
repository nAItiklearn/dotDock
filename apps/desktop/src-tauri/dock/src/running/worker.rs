//! Recomputes the window list on its own thread when the sensors say something changed, and hands it on only
//! when it really is different. The thread sleeps in `recv` between signals; it has no timer.

use super::enumerate::{self, ProcessCache};
use super::sensors::{lock, Shared};
use super::{AppIndex, RawWindow};
use crate::com::ComGuard;
use crate::protocol::DockWindow;
use std::collections::HashSet;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

/// Chooses the icon URL for a window (and queues its extraction): the app's icon when the window belongs to a
/// catalogue app, else the icon of the program that owns it.
pub type IconFor = Arc<dyn Fn(&RawWindow, Option<&str>) -> String + Send + Sync>;

enum Message {
    Refresh,
    Apps(AppIndex),
    Stop,
}

pub struct WindowWorker {
    tx: Sender<Message>,
    thread: Option<JoinHandle<()>>,
    latest: Arc<Mutex<Vec<DockWindow>>>,
    computed: Arc<std::sync::atomic::AtomicU64>,
}

impl WindowWorker {
    /// `on_change` runs on the worker thread with the new list whenever it differs from the previous one.
    pub fn start(
        own_pids: Vec<u32>,
        shared: Arc<Shared>,
        icon_for: IconFor,
        on_change: impl Fn(Vec<DockWindow>) + Send + 'static,
    ) -> std::io::Result<WindowWorker> {
        let (tx, rx) = channel();
        let latest = Arc::new(Mutex::new(Vec::new()));
        let computed = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let state = (Arc::clone(&latest), Arc::clone(&computed));
        let thread = std::thread::Builder::new().name("dock-windows".into()).spawn(move || {
            run(rx, own_pids, shared, icon_for, state, on_change);
        })?;
        Ok(WindowWorker { tx, thread: Some(thread), latest, computed })
    }

    /// A handle the sensors' callback uses to ask for a recompute from another thread.
    pub fn refresher(&self) -> Refresher {
        Refresher(self.tx.clone())
    }

    /// Replaces the catalogue the windows are matched against and recomputes.
    pub fn set_apps(&self, index: AppIndex) {
        let _ = self.tx.send(Message::Apps(index));
    }

    /// The list as of the last recompute.
    pub fn windows(&self) -> Vec<DockWindow> {
        lock(&self.latest).clone()
    }

    /// Recomputes done since start, for the measurements in the spike report.
    pub fn computed(&self) -> u64 {
        self.computed.load(std::sync::atomic::Ordering::Relaxed)
    }
}

#[derive(Clone)]
pub struct Refresher(Sender<Message>);

impl Refresher {
    pub fn refresh(&self) {
        let _ = self.0.send(Message::Refresh);
    }
}

impl Drop for WindowWorker {
    fn drop(&mut self) {
        let _ = self.tx.send(Message::Stop);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

type Latest = (Arc<Mutex<Vec<DockWindow>>>, Arc<std::sync::atomic::AtomicU64>);

fn run(
    rx: Receiver<Message>,
    own_pids: Vec<u32>,
    shared: Arc<Shared>,
    icon_for: IconFor,
    (latest, computed): Latest,
    on_change: impl Fn(Vec<DockWindow>),
) {
    let _com = ComGuard::new();
    let mut index = AppIndex::default();
    let mut cache = ProcessCache::default();
    let mut previous: Vec<DockWindow> = Vec::new();
    while let Ok(first) = rx.recv() {
        // Several signals that queued up while the last recompute ran are one recompute.
        let mut stop = matches!(first, Message::Stop);
        if let Message::Apps(new_index) = first {
            index = new_index;
        }
        while let Ok(next) = rx.try_recv() {
            match next {
                Message::Apps(new_index) => index = new_index,
                Message::Stop => stop = true,
                Message::Refresh => {}
            }
        }
        if stop {
            break;
        }
        let raw = enumerate::list(&own_pids, &mut cache);
        computed.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        *lock(&shared.known) = raw.iter().map(|w| w.hwnd).collect::<HashSet<_>>();
        let flashing = {
            let mut flashing = lock(&shared.flashing);
            flashing.retain(|h| raw.iter().any(|w| w.hwnd == *h && !w.focused));
            flashing.clone()
        };
        let windows: Vec<DockWindow> = raw
            .iter()
            .map(|w| {
                let app_id = index.resolve(w.aumid.as_deref(), w.exe.as_deref()).map(str::to_owned);
                DockWindow {
                    hwnd: w.hwnd.to_string(),
                    icon: icon_for(w, app_id.as_deref()),
                    app_id,
                    title: w.title.clone(),
                    minimized: w.minimized,
                    focused: w.focused,
                    flashing: flashing.contains(&w.hwnd),
                }
            })
            .collect();
        if windows != previous {
            *lock(&latest) = windows.clone();
            previous = windows.clone();
            on_change(windows);
        }
    }
}
