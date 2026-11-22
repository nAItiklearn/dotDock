//! Tells every window when the user picked another Windows wallpaper, so the theme can follow it. The announcement
//! comes from the dock host's window (`Hooks::wallpaper_changed`); the judging is `dotdock_shell::wallpaper_follow`.

use dotdock_shell::boot_log;
use dotdock_shell::wallpaper_follow::{self, Verdict, QUIET};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// Emitted to every window, once per settled change the user made, with `{ path }`.
pub const EVENT_WALLPAPER_CHANGED: &str = "wallpaper://changed";

#[derive(serde::Serialize, Clone)]
struct Changed {
    path: String,
}

/// The file of the last announcement. Windows reports a new wallpaper a moment after it is set, so the home screen
/// reads this file instead of asking Windows again (it got the previous picture, and the colours ran one behind).
static ANNOUNCED: Mutex<Option<PathBuf>> = Mutex::new(None);

fn emit_changed(app: &AppHandle, path: &Path) {
    *ANNOUNCED.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(path.to_path_buf());
    let _ = app.emit(EVENT_WALLPAPER_CHANGED, Changed { path: path.to_string_lossy().into_owned() });
}

/// The bytes of the wallpaper last announced, for the theme to read its colours. The path never comes from a window.
#[tauri::command(async)]
pub fn wallpaper_announced_image() -> Result<tauri::ipc::Response, String> {
    let path = ANNOUNCED.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone();
    let path = path.ok_or("no wallpaper has been announced")?;
    dotdock_shell::wallpaper::image_at(&path).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

/// Where announcements go: the follower thread's channel.
pub struct WallpaperFollow(Mutex<Sender<()>>);

/// Starts the follower. It sleeps on its channel until an announcement arrives.
pub fn start(app: &AppHandle) -> std::io::Result<()> {
    let (announce, announcements) = channel();
    app.manage(WallpaperFollow(Mutex::new(announce)));
    let app = app.clone();
    std::thread::Builder::new().name("wallpaper-follow".into()).spawn(move || {
        while wallpaper_follow::settle(&announcements, QUIET) {
            match wallpaper_follow::judge_current() {
                Verdict::Follow(path) => emit_changed(&app, &path),
                Verdict::Own => {}
                Verdict::Missing(path) => {
                    boot_log::record(&format!("wallpaper follow: {} is not a file, not followed", path.display()));
                }
                Verdict::NoPicture => {}
            }
        }
    })?;
    Ok(())
}

/// The user picked `path` in dotDock's own library. dotDock wrote it, so the follower rightly ignores Windows'
/// announcement of it (theme on and off write wallpapers too, and must not re-theme), but this one is the user's
/// choice: the theme made from the wallpaper follows it like any other.
pub fn user_picked(app: &AppHandle, path: &Path) {
    emit_changed(app, path);
}

/// Windows announced a wallpaper change.
pub fn announce(app: &AppHandle) {
    if let Some(follow) = app.try_state::<WallpaperFollow>() {
        let _ = follow.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner).send(());
    }
}
