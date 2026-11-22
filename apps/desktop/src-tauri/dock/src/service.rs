//! The one object the host holds: the catalogue, the classifier, icons, running windows and the user's
//! choices, behind the calls and events of `protocol.ts`.
//!
//! Nothing here runs on the caller's thread except cheap lookups. Work is done on named threads that sleep
//! until they are told something happened: the sensors (shell hook and window events), the window worker, the
//! icon worker, the catalogue worker (woken by Start menu changes), and the two debounced file writers. There is
//! no timer anywhere, so an idle dock costs nothing.

use crate::catalogue::{self, AppEntry};
use crate::classify::{classify, Subject};
use crate::frozen::FrozenState;
use crate::icons::{IconKey, IconRequest, IconSource, IconWorker};
use crate::protocol::{
    Builtin, Category, CategoryId, CommandResult, DockApp, DockEvent, DockSettings, DockSnapshot, FiledBy, PreviewArgs,
};
use crate::running::sensors::{self, Sensors, Signal};
use crate::running::worker::{IconFor, WindowWorker};
use crate::running::{control, AppIndex};
use crate::starter::starter_layout;
use crate::store::{CatalogueCache, DebouncedFile, StoreData, CACHE_FILE, STORE_FILE};
use crate::thumbnail::Previews;
use crate::util::{normalise_path, now_ms};
use crate::{launch, watch};
use std::collections::HashMap;
use std::io;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

/// What the host gives the service.
pub struct ServiceConfig {
    /// `%APPDATA%\<app>`: holds `dock.json` and `catalogue-cache.json`.
    pub data_dir: PathBuf,
    /// `%LOCALAPPDATA%\dev.dotdock.desktop\dock-icons` (see `icons::default_cache_dir`).
    pub icon_dir: PathBuf,
}

#[derive(Debug, thiserror::Error)]
pub enum ServiceError {
    #[error(transparent)]
    Io(#[from] io::Error),
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

#[derive(Default)]
struct State {
    store: StoreData,
    entries: Vec<AppEntry>,
    apps: Vec<DockApp>,
}

/// Counters for the measurements in `docs/spikes/DOCK_D1.md`.
#[derive(Clone, Copy, Debug, Default)]
pub struct Stats {
    /// Signals the sensors raised (window changes and freeze changes).
    pub signals: u64,
    /// Times the window list was recomputed.
    pub window_recomputes: u64,
    /// Icons taken from the shell (not served from the cache).
    pub icons_extracted: u64,
    pub store_writes: u64,
    pub cache_writes: u64,
    /// Time of the last `ShellExecute`, as measured by `launch`.
    pub last_launch: Option<Duration>,
}

struct Inner {
    state: Mutex<State>,
    events: Sender<DockEvent>,
    store_file: DebouncedFile,
    cache_file: DebouncedFile,
    icons: Arc<IconWorker>,
    app_icons: Arc<Mutex<HashMap<String, String>>>,
    windows: WindowWorker,
    shared: Arc<sensors::Shared>,
    previews: Mutex<Previews>,
    last_launch: Mutex<Option<Duration>>,
}

enum CatalogueMessage {
    Rescan,
    Stop,
}

pub struct DockService {
    // Fields drop in this order: the sources of signals (sensors, watcher) go first, so nothing signals a worker
    // that is already gone; `inner` goes last (the catalogue thread, told to stop in `Drop`, may still hold it).
    _sensors: Sensors,
    _watcher: Option<watch::CatalogueWatcher>,
    rescan: Sender<CatalogueMessage>,
    inner: Arc<Inner>,
}

impl DockService {
    /// Starts everything and returns the service with the channel of events for the dock window. The first
    /// `Apps` event may arrive before the catalogue is scanned (from the cache of the last run).
    pub fn start(cfg: ServiceConfig) -> Result<(DockService, Receiver<DockEvent>), ServiceError> {
        std::fs::create_dir_all(&cfg.data_dir)?;
        let store = StoreData::load(&cfg.data_dir.join(STORE_FILE));
        let (events, events_rx) = channel();
        let icons = Arc::new(IconWorker::start(cfg.icon_dir)?);
        let app_icons: Arc<Mutex<HashMap<String, String>>> = Arc::new(Mutex::new(HashMap::new()));
        let shared = Arc::new(sensors::Shared::default());

        let windows_events = events.clone();
        let windows = WindowWorker::start(
            vec![std::process::id()],
            Arc::clone(&shared),
            icon_provider(Arc::clone(&icons), Arc::clone(&app_icons)),
            move |list| {
                let _ = windows_events.send(DockEvent::Windows(list));
            },
        )?;

        let inner = Arc::new(Inner {
            state: Mutex::new(State { store, ..State::default() }),
            events: events.clone(),
            store_file: DebouncedFile::new(cfg.data_dir.join(STORE_FILE))?,
            cache_file: DebouncedFile::new(cfg.data_dir.join(CACHE_FILE))?,
            icons,
            app_icons,
            windows,
            shared: Arc::clone(&shared),
            previews: Mutex::new(Previews::default()),
            last_launch: Mutex::new(None),
        });

        let refresher = inner.windows.refresher();
        let frozen_events = events;
        let sensors = Sensors::start(shared, move |signal| match signal {
            Signal::WindowsChanged => refresher.refresh(),
            Signal::Frozen(state) => {
                let _ = frozen_events.send(DockEvent::Frozen(state));
            }
        })?;
        inner.windows.refresher().refresh();

        let (rescan, rescan_rx) = channel();
        let catalogue_inner = Arc::clone(&inner);
        // Not joined on drop: a scan in progress finishes in the background rather than holding up shutdown.
        std::thread::Builder::new()
            .name("dock-catalogue".into())
            .spawn(move || catalogue_loop(&catalogue_inner, &rescan_rx))?;

        // Warm start: the last scan is shown at once; it is rescanned only if the Start menu or the package list
        // changed since (or if there is no cache at all).
        let cached = CatalogueCache::load(&cfg.data_dir.join(CACHE_FILE));
        let current = watch::fingerprint();
        let fresh = cached.as_ref().is_some_and(|c| c.fingerprint == current);
        if let Some(cache) = cached {
            inner.install(cache.apps, None);
        }
        if !fresh {
            let _ = rescan.send(CatalogueMessage::Rescan);
        }

        let rescan_on_change = rescan.clone();
        let watcher = watch::CatalogueWatcher::start(move || {
            let _ = rescan_on_change.send(CatalogueMessage::Rescan);
        })
        .ok();

        Ok((DockService { inner, rescan, _watcher: watcher, _sensors: sensors }, events_rx))
    }

    /// Everything the dock window needs to draw its first frame.
    pub fn snapshot(&self) -> DockSnapshot {
        let state = lock(&self.inner.state);
        DockSnapshot {
            categories: state.store.categories.clone(),
            apps: state.apps.clone(),
            windows: self.inner.windows.windows(),
            settings: state.store.settings.clone(),
        }
    }

    /// Why the dock should (not) render right now.
    pub fn frozen(&self) -> FrozenState {
        *lock(&self.inner.shared.frozen)
    }

    /// Which desktop notifications Windows accepted (shell hook, session lock, display power, window events).
    pub fn registrations(&self) -> sensors::Registrations {
        *lock(&self.inner.shared.registered)
    }

    /// Asks for a rescan of the catalogue now (the dock does this itself when the Start menu changes).
    pub fn rescan(&self) {
        let _ = self.rescan.send(CatalogueMessage::Rescan);
    }

    pub fn stats(&self) -> Stats {
        Stats {
            signals: self.inner.shared.signals.load(std::sync::atomic::Ordering::Relaxed),
            window_recomputes: self.inner.windows.computed(),
            icons_extracted: self.inner.icons.extracted(),
            store_writes: self.inner.store_file.writes(),
            cache_writes: self.inner.cache_file.writes(),
            last_launch: *lock(&self.inner.last_launch),
        }
    }

    /// The cached icon file for a `dock-icon://` URL, waiting up to `timeout` for an extraction in progress.
    pub fn icon_file(&self, url: &str, timeout: Duration) -> Option<PathBuf> {
        let key = crate::icons::key_from_url(url)?;
        self.inner.icons.wait_for(&key, timeout).or_else(|| self.inner.icons.path(&key))
    }

    pub fn launch(&self, app_id: &str) -> CommandResult {
        let target = lock(&self.inner.state).entries.iter().find(|e| e.id == app_id).and_then(AppEntry::launch_target);
        let Some(target) = target else { return CommandResult::failed("that app is not installed any more") };
        match launch::launch(&target) {
            Ok(took) => {
                *lock(&self.inner.last_launch) = Some(took);
                CommandResult::Ok
            }
            Err(error) => CommandResult::failed(format!("could not start it: {error}")),
        }
    }

    /// A click on a running app: restore and focus, or minimise if it is already focused.
    pub fn activate(&self, hwnd: &str) -> CommandResult {
        let Ok(handle) = hwnd.parse::<isize>() else { return CommandResult::failed("not a window handle") };
        let (minimised, focused) = self
            .inner
            .windows
            .windows()
            .iter()
            .find(|w| w.hwnd == hwnd)
            .map_or((false, false), |w| (w.minimized, w.focused));
        match control::toggle(handle, minimised, focused) {
            control::Outcome::Gone => CommandResult::failed("that window is gone"),
            control::Outcome::Focused | control::Outcome::Flashed => CommandResult::Ok,
        }
    }

    pub fn close_window(&self, hwnd: &str) -> CommandResult {
        match hwnd.parse::<isize>() {
            Ok(handle) if control::close(handle) => CommandResult::Ok,
            Ok(_) => CommandResult::failed("that window is gone"),
            Err(_) => CommandResult::failed("not a window handle"),
        }
    }

    /// Files an app where the user dropped it. The choice survives restarts and beats every rule.
    pub fn set_category(&self, app_id: &str, category: CategoryId) -> CommandResult {
        let apps = {
            let mut state = lock(&self.inner.state);
            if !state.store.has_category(&category) {
                return CommandResult::failed("no such category");
            }
            if !state.entries.iter().any(|e| e.id == app_id) {
                return CommandResult::failed("that app is not installed any more");
            }
            state.store.assignments.insert(app_id.to_owned(), category);
            self.inner.refile(&mut state);
            self.inner.store_file.save_json(&state.store);
            state.apps.clone()
        };
        let _ = self.inner.events.send(DockEvent::Apps(apps));
        CommandResult::Ok
    }

    /// Replaces the categories (rename, recolour, reorder, add, delete). "Other" always stays: it is where
    /// apps land when their category is gone.
    pub fn save_categories(&self, categories: Vec<Category>) -> CommandResult {
        let other = CategoryId::from(Builtin::Other);
        let mut seen = Vec::new();
        for c in &categories {
            if seen.contains(&c.id) {
                return CommandResult::failed("two categories share an id");
            }
            seen.push(c.id.clone());
        }
        if !seen.contains(&other) {
            return CommandResult::failed("the Other category cannot be removed");
        }
        let apps = {
            let mut state = lock(&self.inner.state);
            state.store.categories = categories;
            let known: Vec<CategoryId> = state.store.categories.iter().map(|c| c.id.clone()).collect();
            state.store.assignments.retain(|_, c| known.contains(c));
            self.inner.refile(&mut state);
            self.inner.store_file.save_json(&state.store);
            state.apps.clone()
        };
        let _ = self.inner.events.send(DockEvent::Apps(apps));
        CommandResult::Ok
    }

    pub fn set_settings(&self, settings: DockSettings) -> CommandResult {
        let settings = settings.at_the_bottom();
        if let Err(reason) = settings.validate() {
            return CommandResult::failed(reason);
        }
        {
            let mut state = lock(&self.inner.state);
            state.store.settings = settings.clone();
            // The user has chosen what is on the dock, so the first layout never replaces it.
            state.store.laid_out = true;
            self.inner.store_file.save_json(&state.store);
        }
        let _ = self.inner.events.send(DockEvent::Settings(settings));
        CommandResult::Ok
    }

    /// Shows or hides live previews of an app's windows above `args.anchor`, inside the dock window `host`.
    pub fn preview(&self, host: isize, scale: f64, args: &PreviewArgs) {
        let mut previews = lock(&self.inner.previews);
        let sources: Vec<isize> = args.hwnds.iter().filter_map(|h| h.parse().ok()).collect();
        match (&args.anchor, sources.is_empty()) {
            (Some(anchor), false) => previews.show(host, &sources, *anchor, scale),
            _ => previews.hide(),
        }
    }
}

impl Drop for DockService {
    fn drop(&mut self) {
        let _ = self.rescan.send(CatalogueMessage::Stop);
        // Whatever was changed in the last second reaches the disk now instead of being lost on a quick exit.
        self.inner.store_file.flush();
        self.inner.cache_file.flush();
    }
}

fn catalogue_loop(inner: &Inner, rx: &Receiver<CatalogueMessage>) {
    while let Ok(message) = rx.recv() {
        let mut stop = matches!(message, CatalogueMessage::Stop);
        // Rescans that queued up while one ran are one rescan.
        while let Ok(next) = rx.try_recv() {
            stop |= matches!(next, CatalogueMessage::Stop);
        }
        if stop {
            return;
        }
        // The fingerprint is taken before the scan: a change during the scan then shows as stale next time.
        let fingerprint = watch::fingerprint();
        let scanned = catalogue::enumerate();
        inner.install(scanned.apps, Some(fingerprint));
    }
}

fn icon_provider(icons: Arc<IconWorker>, app_icons: Arc<Mutex<HashMap<String, String>>>) -> IconFor {
    let exe_icons: Mutex<HashMap<String, String>> = Mutex::new(HashMap::new());
    Arc::new(move |window, app_id| {
        if let Some(url) = app_id.and_then(|id| lock(&app_icons).get(id).cloned()) {
            return url;
        }
        let Some(exe) = window.exe.as_deref() else { return String::new() };
        let key = normalise_path(exe);
        if let Some(url) = lock(&exe_icons).get(&key) {
            return url.clone();
        }
        let sources = vec![IconSource::File(PathBuf::from(exe))];
        let icon_key = IconKey::new(&format!("exe:{key}"), &sources);
        let url = icon_key.url();
        icons.request(IconRequest { key: icon_key, sources });
        lock(&exe_icons).insert(key, url.clone());
        url
    })
}

impl Inner {
    /// Takes a scan (or the cached scan of the last run): remembers when each app was first seen, queues icon
    /// extraction for apps whose icon is not on disk, refiles everything, and tells the window and the host.
    fn install(&self, entries: Vec<AppEntry>, fingerprint: Option<String>) {
        let urls: HashMap<String, String> = entries
            .iter()
            .map(|entry| {
                let sources = IconSource::candidates(entry);
                let key = IconKey::new(&entry.id, &sources);
                let url = key.url();
                self.icons.request(IconRequest { key, sources });
                (entry.id.clone(), url)
            })
            .collect();
        *lock(&self.app_icons) = urls;

        let (apps, changed) = {
            let mut state = lock(&self.state);
            let now = now_ms();
            let baseline = if state.store.scanned_once { now } else { 0 };
            let mut store_dirty = false;
            for entry in &entries {
                if !state.store.first_seen.contains_key(&entry.id) {
                    state.store.first_seen.insert(entry.id.clone(), baseline);
                    store_dirty = true;
                }
            }
            // Only a real scan, not the cache of the last run, ends "everything is already installed".
            if fingerprint.is_some() && !state.store.scanned_once {
                state.store.scanned_once = true;
                store_dirty = true;
            }
            let before = state.apps.clone();
            state.entries = entries.clone();
            self.refile(&mut state);
            let (laid_out_dirty, laid_out) = self.lay_out_once(&mut state);
            if store_dirty || laid_out_dirty {
                self.store_file.save_json(&state.store);
            }
            if let Some(settings) = laid_out {
                let _ = self.events.send(DockEvent::Settings(settings));
            }
            (state.apps.clone(), state.apps != before)
        };
        if let Some(fingerprint) = fingerprint {
            self.cache_file.save_json(&CatalogueCache::new(fingerprint, entries.clone()));
        }
        self.windows.set_apps(AppIndex::new(&entries));
        if changed {
            let _ = self.events.send(DockEvent::Apps(apps));
        }
    }

    /// Places the first layout once, on a dock that has nothing on it, after the first catalogue with apps.
    /// Returns whether the store changed, and the new settings when the layout was placed.
    fn lay_out_once(&self, state: &mut State) -> (bool, Option<DockSettings>) {
        if state.store.laid_out || state.apps.is_empty() {
            return (false, None);
        }
        state.store.laid_out = true;
        let settings = &mut state.store.settings;
        if !settings.pinned.is_empty() || !settings.tiles.is_empty() {
            return (true, None);
        }
        let (pinned, tiles) = starter_layout(&state.apps);
        settings.pinned = pinned;
        settings.tiles = tiles;
        (true, Some(settings.clone()))
    }

    /// Recomputes every app's category from the classifier and the user's filings.
    fn refile(&self, state: &mut State) {
        let urls = lock(&self.app_icons).clone();
        let other = CategoryId::from(Builtin::Other);
        let apps = state
            .entries
            .iter()
            .map(|entry| {
                let user = state.store.assignments.get(&entry.id);
                let mut filed = classify(&Subject::from_entry(entry), user);
                if !state.store.has_category(&filed.category) {
                    filed.category = other.clone();
                    filed.filed_by = FiledBy::Fallback;
                }
                DockApp {
                    id: entry.id.clone(),
                    name: entry.name.clone(),
                    category: filed.category,
                    filed_by: filed.filed_by,
                    icon: urls.get(&entry.id).cloned().unwrap_or_default(),
                    publisher: entry.publisher.clone(),
                    first_seen: state.store.first_seen.get(&entry.id).copied().unwrap_or(0),
                }
            })
            .collect();
        state.apps = apps;
    }
}
