//! The commands Settings and the overlay call through `src/lib/native/api.ts`: startup, displays,
//! wallpapers, global hotkeys, the Settings window, app information and the dock's settings.
//! `src/lib/native/commands.test.ts` fails when the UI invokes a name this file (or lib.rs) does not register.

use crate::desktop_host::{self, Hwnd};
use dotdock_shell::hotkey::{Hotkeys, Status};
use dotdock_shell::wallpaper::{self, Fit};
use dotdock_shell::wallpaper_library::mime_of;
use dotdock_shell::wallpaper_library::{Assignment, Library, IMPORTED_PREFIX};
use dotdock_shell::{autostart, boot_log, desktop_icons, displays, file_dialog};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

/// The event every window hears for cross-window commands (`src/lib/bus.ts`).
const BUS_EVENT: &str = "dotdock://command";
/// Settings listens for this to move to a page when it is already open.
const SETTINGS_NAVIGATE: &str = "settings://navigate";
/// Custom scheme that serves imported wallpapers to the webview (`http://dotdock-wallpaper.localhost/<id>`).
pub const WALLPAPER_SCHEME: &str = "dotdock-wallpaper";
/// What `wallpapers_assign` takes as the monitor to mean every display.
const ALL_DISPLAYS: &str = "all";
fn data_dir() -> Result<PathBuf, String> {
    dotdock_shell::app_data_dir().ok_or_else(|| "the app data folder is not available".to_owned())
}

// --------------------------------------------------------------------- startup

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootStage {
    name: String,
    ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastBoot {
    /// Unix milliseconds; the UI formats it.
    started_at: u64,
    stages: Vec<BootStage>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupState {
    launch_at_sign_in: bool,
    hide_desktop_icons: bool,
    startup_delay_removed: bool,
    last_boot: Option<LastBoot>,
}

fn startup_state() -> StartupState {
    StartupState {
        launch_at_sign_in: autostart::is_enabled(),
        hide_desktop_icons: desktop_icons::visible() == Some(false),
        startup_delay_removed: autostart::startup_delay_removed(),
        last_boot: boot_log::last_boot().map(|b| LastBoot {
            started_at: b.started_unix_ms,
            stages: b.stages.into_iter().map(|s| BootStage { name: s.name, ms: s.ms }).collect(),
        }),
    }
}

#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub enum StartupToggle {
    LaunchAtSignIn,
    HideDesktopIcons,
}

#[tauri::command]
pub async fn startup_get() -> StartupState {
    startup_state()
}

#[tauri::command]
pub async fn startup_set(setting: StartupToggle, value: bool) -> Result<StartupState, String> {
    match setting {
        StartupToggle::LaunchAtSignIn if value => autostart::enable().map(|_| ()).map_err(|e| e.to_string())?,
        StartupToggle::LaunchAtSignIn => autostart::disable().map_err(|e| e.to_string())?,
        StartupToggle::HideDesktopIcons => {
            // The original visibility must be on record before the first change, so restore can undo it.
            dotdock_shell::snapshot::ensure(false).map_err(|e| e.to_string())?;
            desktop_icons::set_visible(!value).map_err(|e| e.to_string())?;
            // Asking for the icons back takes them off dotDock's hands, so switching the theme off does
            // not then "restore" them to whatever the snapshot held (B4). The next start still hides them
            // while the theme is on: the environment owns them for as long as it runs.
            if let Some(dir) = (!value).then(dotdock_shell::app_data_dir).flatten() {
                desktop_icons::forget(&dir);
            }
        }
    }
    Ok(startup_state())
}

/// What the in-app restore did, field for field as the Recovery page shows it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport {
    wallpaper_restored: bool,
    desktop_icons_shown: bool,
    autostart_removed: bool,
    startup_delay_restored: bool,
}

#[tauri::command]
pub async fn restore_windows(app: AppHandle) -> Result<RestoreReport, String> {
    let report = dotdock_shell::restore::restore_windows().map_err(|e| e.to_string())?;
    // The taskbar is back: the dock must not take its place again at the next change.
    crate::dock_host::taskbar_released(&app);
    Ok(RestoreReport {
        wallpaper_restored: report.wallpaper_restored.is_some() || !report.had_snapshot,
        desktop_icons_shown: report.desktop_icons_restored || !report.had_snapshot,
        autostart_removed: report.autostart_removed,
        startup_delay_restored: !autostart::startup_delay_removed(),
    })
}

// -------------------------------------------------------------------- displays

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct PixelRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    /// The Windows device name, such as `\\.\DISPLAY1`.
    id: String,
    name: String,
    primary: bool,
    bounds: PixelRect,
    work_area: PixelRect,
    scale_factor: f64,
    refresh_hz: Option<u32>,
}

/// A display's desktop rectangle in physical pixels: left, top, right, bottom.
type Bounds = (i32, i32, i32, i32);

fn connected_displays(app: &AppHandle) -> Result<Vec<(DisplayInfo, Bounds)>, String> {
    let primary = app.primary_monitor().map_err(|e| e.to_string())?;
    let primary_name = primary.as_ref().and_then(|m| m.name().cloned());
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    Ok(monitors
        .into_iter()
        .map(|m| {
            let id = m.name().cloned().unwrap_or_default();
            let (pos, size, work) = (m.position(), m.size(), m.work_area());
            let rect = (pos.x, pos.y, pos.x + to_i32(size.width), pos.y + to_i32(size.height));
            let info = DisplayInfo {
                name: displays::label(&id),
                primary: primary_name.as_deref() == Some(id.as_str()),
                bounds: PixelRect { x: pos.x, y: pos.y, width: size.width, height: size.height },
                work_area: PixelRect {
                    x: work.position.x,
                    y: work.position.y,
                    width: work.size.width,
                    height: work.size.height,
                },
                scale_factor: m.scale_factor(),
                refresh_hz: displays::refresh_hz(&id),
                id,
            };
            (info, rect)
        })
        .collect())
}

fn to_i32(v: u32) -> i32 {
    i32::try_from(v).unwrap_or(i32::MAX)
}

#[tauri::command]
pub async fn displays_list(app: AppHandle) -> Result<Vec<DisplayInfo>, String> {
    Ok(connected_displays(&app)?.into_iter().map(|(d, _)| d).collect())
}

// ------------------------------------------------------------------ wallpapers

/// One wallpaper for the pickers: the bundled set (one entry per light or dark variant) and the user's own.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperItem {
    /// Unique: `<manifest id>-<mode>` for bundled ones, `imported-<n>` for the user's.
    id: String,
    name: String,
    source: &'static str,
    /// `dark` or `light` for bundled ones; none for the user's.
    mode: Option<String>,
    accent: Option<String>,
    /// A URL the webview loads: a web path for bundled thumbnails, the custom scheme for imported pictures.
    thumbnail_url: String,
}

pub(crate) fn bundled_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().resource_dir().map(|d| d.join("wallpapers")).map_err(|e| e.to_string())
}

fn library() -> Result<Library, String> {
    Library::open(&data_dir()?).map_err(|e| e.to_string())
}

pub fn imported_url(id: &str) -> String {
    format!("http://{WALLPAPER_SCHEME}.localhost/{id}")
}

fn bundled_key(id: &str, mode: &str) -> String {
    format!("{id}-{mode}")
}

#[tauri::command]
pub async fn wallpapers_list(app: AppHandle) -> Result<Vec<WallpaperItem>, String> {
    let bundled = wallpaper::bundled(&bundled_dir(&app)?).map_err(|e| e.to_string())?;
    let mut items: Vec<WallpaperItem> = bundled
        .into_iter()
        .map(|(e, _)| WallpaperItem {
            id: bundled_key(&e.id, &e.mode),
            name: e.name,
            source: "bundled",
            thumbnail_url: e.thumb.map(|t| format!("/{t}")).unwrap_or_default(),
            mode: Some(e.mode),
            accent: Some(e.accent),
        })
        .collect();
    items.extend(library()?.imported().map_err(|e| e.to_string())?.into_iter().map(imported_item));
    Ok(items)
}

fn imported_item(e: dotdock_shell::wallpaper_library::Imported) -> WallpaperItem {
    WallpaperItem {
        thumbnail_url: imported_url(&e.id),
        id: e.id,
        name: e.name,
        source: "imported",
        mode: None,
        accent: None,
    }
}

/// The file behind a wallpaper id, or the user's original picture for None.
fn wallpaper_file(app: &AppHandle, id: Option<&str>) -> Result<PathBuf, String> {
    let Some(id) = id else {
        return wallpaper::original()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "your original wallpaper is not on record".to_owned());
    };
    if id.starts_with(IMPORTED_PREFIX) {
        let lib = library()?;
        let entry = lib.find(id).map_err(|e| e.to_string())?;
        return Ok(lib.path_of(&entry));
    }
    wallpaper::bundled(&bundled_dir(app)?)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|(e, _)| bundled_key(&e.id, &e.mode) == id)
        .map(|(_, path)| path)
        .ok_or_else(|| format!("no wallpaper {id}"))
}

#[tauri::command]
pub async fn wallpapers_assignments(app: AppHandle) -> Result<Vec<Assignment>, String> {
    let saved = library()?.assignments().map_err(|e| e.to_string())?;
    // Every connected display has an entry; one never chosen shows the original.
    Ok(connected_displays(&app)?
        .into_iter()
        .map(|(d, _)| {
            saved.iter().find(|a| a.monitor_id == d.id).cloned().unwrap_or(Assignment {
                monitor_id: d.id,
                wallpaper_id: None,
                fit: Fit::default(),
            })
        })
        .collect())
}

/// Sets the real Windows wallpaper on one display or all of them, then records the choice.
#[tauri::command]
pub async fn wallpapers_assign(
    app: AppHandle,
    monitor_id: String,
    wallpaper_id: Option<String>,
    fit: Fit,
) -> Result<Vec<Assignment>, String> {
    let file = wallpaper_file(&app, wallpaper_id.as_deref())?;
    let all = connected_displays(&app)?;
    let targets: Vec<String> = if monitor_id == ALL_DISPLAYS {
        wallpaper::apply(&file, None, fit).map_err(|e| e.to_string())?;
        all.iter().map(|(d, _)| d.id.clone()).collect()
    } else {
        let (_, rect) =
            all.iter().find(|(d, _)| d.id == monitor_id).ok_or_else(|| format!("no display {monitor_id}"))?;
        let shell = wallpaper::monitor_rects().map_err(|e| e.to_string())?;
        let device = shell
            .iter()
            .find(|m| m.rect == *rect)
            .ok_or_else(|| "Windows does not list that display for wallpapers".to_owned())?;
        wallpaper::apply(&file, Some(&device.device_path), fit).map_err(|e| e.to_string())?;
        vec![monitor_id]
    };
    library()?.assign(&targets, wallpaper_id.as_deref(), fit).map_err(|e| e.to_string())?;
    crate::wallpaper_host::user_picked(&app, &file);
    wallpapers_assignments(app).await
}

/// Opens the Open dialog over Settings and copies the chosen picture into the library.
#[tauri::command]
pub async fn wallpapers_import(window: tauri::WebviewWindow) -> Result<Option<WallpaperItem>, String> {
    let owner = window.hwnd().ok().map(|h| h.0 as isize);
    let picked = file_dialog::pick_image(owner, "Choose a picture for your desktop").map_err(|e| e.to_string())?;
    let Some(path) = picked else { return Ok(None) };
    let entry = library()?.import(&path).map_err(|e| e.to_string())?;
    Ok(Some(imported_item(entry)))
}

#[tauri::command]
pub async fn wallpapers_remove(id: String) -> Result<(), String> {
    library()?.remove(&id).map_err(|e| e.to_string())
}

/// Serves `http://dotdock-wallpaper.localhost/<imported id>` from the library, nothing else.
pub fn serve_wallpaper(request: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    let id = request.uri().path().trim_start_matches('/');
    let found = id
        .starts_with(IMPORTED_PREFIX)
        .then(library)
        .and_then(Result::ok)
        .and_then(|lib| lib.find(id).ok().map(|e| lib.path_of(&e)))
        .and_then(|path| Some((mime_of(&path), std::fs::read(&path).ok()?)));
    let response = match found {
        Some((mime, bytes)) => tauri::http::Response::builder().header("Content-Type", mime).body(bytes),
        None => tauri::http::Response::builder().status(tauri::http::StatusCode::NOT_FOUND).body(Vec::new()),
    };
    response.unwrap_or_default()
}

// ------------------------------------------------------------------- shortcuts

pub struct HotkeyState(Mutex<Option<Hotkeys>>);

impl HotkeyState {
    pub fn start(app: &AppHandle) -> HotkeyState {
        let handle = app.clone();
        let hotkeys = Hotkeys::spawn(move |action| on_hotkey(&handle, action));
        if let Err(err) = &hotkeys {
            boot_log::record(&format!("hotkeys unavailable: {err}"));
        }
        HotkeyState(Mutex::new(hotkeys.ok()))
    }
}

/// What a pressed global hotkey does. Names match `ShortcutAction` in the UI.
fn on_hotkey(app: &AppHandle, action: &str) {
    match action {
        "toggleEditMode" => {
            let _ = app.emit(BUS_EVENT, serde_json::json!({ "type": "edit-mode", "on": "toggle" }));
        }
        "nextProfile" => {
            let _ = app.emit(BUS_EVENT, serde_json::json!({ "type": "next-profile" }));
        }
        "openSettings" => crate::tray::open_settings(app),
        _ => {}
    }
}

#[tauri::command]
pub async fn shortcuts_register(
    bindings: BTreeMap<String, String>,
    state: State<'_, HotkeyState>,
) -> Result<BTreeMap<String, Status>, String> {
    let guard = state.0.lock().map_err(|_| "the hotkey service stopped".to_owned())?;
    let hotkeys = guard.as_ref().ok_or_else(|| "global hotkeys are not available on this system".to_owned())?;
    Ok(hotkeys.replace(bindings.into_iter().collect()).into_iter().collect())
}

// ---------------------------------------------------------- windows and app info

/// Opens or focuses Settings, on a `#/<section>/<page>` route when one is given. Async so it runs off the main
/// thread: a window built from a synchronous command (which Windows runs on the main thread) never finished loading
/// its page and stayed blank white.
#[tauri::command(async)]
pub fn settings_open(app: AppHandle, page: Option<String>) {
    // Only Settings' own routes; anything else opens it where it was.
    let route = page.filter(|p| p.starts_with("#/"));
    crate::tray::open_settings_at(&app, route.as_deref());
}

pub fn navigate_settings(window: &tauri::WebviewWindow, route: &str) {
    let _ = window.emit(SETTINGS_NAVIGATE, route);
}

/// The overlay entered or left edit mode: it takes the keyboard while editing and is pushed back down after.
#[tauri::command]
pub fn overlay_edit_mode(app: AppHandle, on: bool) {
    let Some(window) = app.get_webview_window(crate::home_host::OVERLAY_LABEL) else { return };
    if let Ok(hwnd) = window.hwnd() {
        desktop_host::set_typing(Hwnd::from_raw(hwnd.0), on);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    build: String,
    os: String,
    webview: String,
    data_dir: String,
}

#[tauri::command]
pub async fn app_info(app: AppHandle) -> Result<AppInfo, String> {
    let profile = if cfg!(debug_assertions) { "debug" } else { "release" };
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        build: format!("{profile}, {}-{}", std::env::consts::ARCH, std::env::consts::OS),
        os: sysinfo::System::long_os_version().unwrap_or_else(|_| "Windows".to_owned()),
        webview: tauri::webview_version().map(|v| format!("WebView2 {v}")).map_err(|e| e.to_string())?,
        data_dir: data_dir()?.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn app_open_data_folder() -> Result<(), String> {
    let dir = data_dir()?;
    // Explorer returns 1 even on success, so only a failure to start it counts.
    std::process::Command::new("explorer.exe").arg(&dir).spawn().map(|_| ()).map_err(|e| e.to_string())
}

// ----------------------------------------------------------------- dock settings

/// Where the dock keeps its settings: `<app data>\dock\dock.json`, the dock service's own store.
fn dock_store_path() -> Result<PathBuf, String> {
    let dir = data_dir()?.join(DOCK_FOLDER);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(dotdock_dock::store::STORE_FILE))
}

/// The dock host keeps its data in this folder under the app data folder.
const DOCK_FOLDER: &str = "dock";

/// The running dock's settings when its backend is up (the store has one writer, the dock service); the stored
/// file otherwise.
#[tauri::command]
pub async fn settings_dock_get(app: AppHandle) -> Result<dotdock_dock::protocol::DockSettings, String> {
    match app.try_state::<crate::dock_host::DockState>() {
        Some(dock) => Ok(dock.settings()),
        None => Ok(dotdock_dock::store::StoreData::load(&dock_store_path()?).settings),
    }
}

/// Hands the dock's settings to the running dock service, which stores them and tells the dock window; without a
/// running dock they are written to its store for the next start.
#[tauri::command]
pub async fn settings_dock_set(
    app: AppHandle,
    settings: dotdock_dock::protocol::DockSettings,
) -> Result<dotdock_dock::protocol::DockSettings, String> {
    settings.validate()?;
    if let Some(dock) = app.try_state::<crate::dock_host::DockState>() {
        return match dock.set_settings(settings) {
            dotdock_dock::protocol::CommandResult::Ok => Ok(dock.settings()),
            dotdock_dock::protocol::CommandResult::Failed { reason } => Err(reason),
        };
    }
    let path = dock_store_path()?;
    let mut store = dotdock_dock::store::StoreData::load(&path);
    store.settings = settings;
    let bytes = serde_json::to_vec_pretty(&store).map_err(|e| e.to_string())?;
    dotdock_dock::store::write_atomic(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(store.settings)
}

/// One app the dock knows, for the Items page: what the pinned ids are called.
#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct DockAppName {
    id: String,
    name: String,
}

/// The apps of the dock's last catalogue scan, by name. Empty until the dock has scanned once.
fn dock_app_names(cache: Option<dotdock_dock::store::CatalogueCache>) -> Vec<DockAppName> {
    let mut apps: Vec<DockAppName> =
        cache.map(|c| c.apps.into_iter().map(|a| DockAppName { id: a.id, name: a.name }).collect()).unwrap_or_default();
    apps.sort_by_key(|a| a.name.to_lowercase());
    apps
}

#[tauri::command]
pub async fn settings_dock_apps() -> Result<Vec<DockAppName>, String> {
    let dir = data_dir()?.join(DOCK_FOLDER);
    Ok(dock_app_names(dotdock_dock::store::CatalogueCache::load(&dir.join(dotdock_dock::store::CACHE_FILE))))
}

#[cfg(test)]
mod tests {
    use super::*;
    use dotdock_dock::catalogue::AppEntry;
    use dotdock_dock::store::CatalogueCache;

    fn entry(id: &str, name: &str) -> AppEntry {
        AppEntry { id: id.to_owned(), name: name.to_owned(), ..AppEntry::default() }
    }

    #[test]
    fn dock_app_names_are_sorted_by_name_and_empty_without_a_scan() {
        assert!(dock_app_names(None).is_empty());
        let cache = CatalogueCache::new("f".to_owned(), vec![entry("b", "zed"), entry("a", "Alacritty")]);
        let ids: Vec<String> = dock_app_names(Some(cache)).into_iter().map(|a| a.id).collect();
        assert_eq!(ids, ["a", "b"]);
    }
}
