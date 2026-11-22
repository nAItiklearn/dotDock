//! The single entry point the dock host uses: subscribe to a tile, send it commands, get its data pushed.
//!
//! A tile's provider runs only between its first `subscribe` and its last `unsubscribe`. Providers push through
//! the `Emitter` given at construction, from their own threads; `command` and `subscribe` are blocking calls and
//! must be made from a worker thread, not the UI thread (an async Tauri command with `spawn_blocking` is right).

use crate::audio::{self, Audio};
use crate::calendar::{self, Calendar};
use crate::clipboard::{self, Clipboard};
use crate::colour::{self, ColourPicker};
use crate::contacts::Contacts;
use crate::emit::{lock, Emitter};
use crate::folder::{FolderProvider, Kind};
use crate::history::History;
use crate::microphone::{self, Microphone, MicrophoneLevelProvider};
use crate::paths::{self, DataDir};
use crate::protocol::{CommandResult, ContactAction, TileCommand, TileData, TileId};
use crate::settings::Settings;
use crate::shelf::Shelf;
use crate::thumbs::Thumbs;
use crate::toggles::{self, radios, Toggles};
use crate::voicememo::VoiceMemo;
use crate::{screenshots, shell};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};

struct Inner {
    audio: Audio,
    microphone: Microphone,
    mic_level: MicrophoneLevelProvider,
    calendar: Calendar,
    clipboard: Clipboard,
    screenshots: FolderProvider,
    downloads: FolderProvider,
    shelf: Shelf,
    toggles: Toggles,
    history: History,
    contacts: Contacts,
    voice_memo: VoiceMemo,
    colour: ColourPicker,
    thumbs: Thumbs,
    subscriptions: Mutex<HashMap<TileId, usize>>,
}

#[derive(Clone)]
pub struct TileHub {
    inner: Arc<Inner>,
}

/// True when `path` is `folder` or lies under it, compared the way Windows compares paths (case-insensitive) and
/// refusing `..` tricks.
fn is_within(path: &Path, folder: &Path) -> bool {
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return false;
    }
    let norm = |p: &Path| p.to_string_lossy().replace('/', "\\").trim_end_matches('\\').to_lowercase();
    let (p, f) = (norm(path), norm(folder));
    p == f || p.starts_with(&format!("{f}\\"))
}

impl TileHub {
    pub fn new(data_dir: DataDir, emitter: Emitter) -> Self {
        let settings = Settings::load(data_dir.settings());
        let inner = Inner {
            audio: Audio::new(emitter.clone()),
            microphone: Microphone::new(emitter.clone()),
            mic_level: MicrophoneLevelProvider::new(emitter.clone()),
            calendar: Calendar::new(emitter.clone(), settings.clone()),
            clipboard: Clipboard::new(emitter.clone(), settings, data_dir.clipboard_vault()),
            screenshots: FolderProvider::new(Kind::Screenshots, paths::screenshots(), emitter.clone()),
            downloads: FolderProvider::new(Kind::Downloads, paths::downloads(), emitter.clone()),
            shelf: Shelf::new(data_dir.shelf(), emitter.clone()),
            toggles: Toggles::new(emitter.clone()),
            history: History::new(emitter.clone()),
            contacts: Contacts::new(data_dir.contacts(), emitter.clone()),
            voice_memo: VoiceMemo::new(paths::voice_memos(), emitter.clone()),
            colour: ColourPicker::new(data_dir.colour_history(), emitter),
            thumbs: Thumbs::default(),
            subscriptions: Mutex::new(HashMap::new()),
        };
        Self { inner: Arc::new(inner) }
    }

    fn start(&self, tile: TileId) -> Result<(), String> {
        let i = &self.inner;
        match tile {
            TileId::Audio => i.audio.start(),
            TileId::Microphone => i.microphone.start(),
            TileId::MicrophoneLevel => i.mic_level.start(),
            TileId::Calendar => i.calendar.start(),
            TileId::Clipboard => i.clipboard.start(),
            TileId::Screenshots => i.screenshots.start(),
            TileId::Downloads => i.downloads.start(),
            TileId::Toggles => i.toggles.start(),
            TileId::SystemHistory => i.history.start(),
            // These hold data that only commands change, or run only on demand, so there is nothing to start.
            TileId::Shelf | TileId::Contacts | TileId::VoiceMemo | TileId::ColourPicker => Ok(()),
        }
    }

    fn stop(&self, tile: TileId) {
        let i = &self.inner;
        match tile {
            TileId::Audio => i.audio.stop(),
            TileId::Microphone => i.microphone.stop(),
            TileId::MicrophoneLevel => i.mic_level.stop(),
            TileId::Calendar => i.calendar.stop(),
            TileId::Clipboard => i.clipboard.stop(),
            TileId::Screenshots => i.screenshots.stop(),
            TileId::Downloads => i.downloads.stop(),
            TileId::Toggles => i.toggles.stop(),
            TileId::SystemHistory => i.history.stop(),
            TileId::VoiceMemo => i.voice_memo.stop(),
            TileId::ColourPicker => i.colour.stop(),
            TileId::Shelf | TileId::Contacts => {}
        }
    }

    /// The current data of a tile, without subscribing.
    pub fn state(&self, tile: TileId) -> TileData {
        let i = &self.inner;
        match tile {
            TileId::Audio => TileData::Audio(i.audio.state()),
            TileId::Microphone => TileData::Microphone(i.microphone.state()),
            TileId::MicrophoneLevel => TileData::MicrophoneLevel(i.mic_level.state()),
            TileId::Calendar => TileData::Calendar(i.calendar.state()),
            TileId::Clipboard => TileData::Clipboard(i.clipboard.state()),
            TileId::Screenshots => TileData::Screenshots(i.screenshots.state()),
            TileId::Downloads => TileData::Downloads(i.downloads.state()),
            TileId::Shelf => TileData::Shelf(i.shelf.state()),
            TileId::Toggles => TileData::Toggles(i.toggles.state()),
            TileId::SystemHistory => TileData::SystemHistory(i.history.state()),
            TileId::Contacts => TileData::Contacts(i.contacts.state()),
            TileId::VoiceMemo => TileData::VoiceMemo(i.voice_memo.state()),
            TileId::ColourPicker => TileData::ColourPicker(i.colour.state()),
        }
    }

    /// Starts the tile's provider if this is its first subscriber, and returns its current data. Updates arrive
    /// through the emitter until the matching `unsubscribe`.
    pub fn subscribe(&self, tile: TileId) -> Result<TileData, String> {
        let first = {
            let mut subs = lock(&self.inner.subscriptions);
            let n = subs.entry(tile).or_insert(0);
            *n += 1;
            *n == 1
        };
        if first {
            if let Err(e) = self.start(tile) {
                self.release(tile);
                return Err(e);
            }
        }
        Ok(self.state(tile))
    }

    fn release(&self, tile: TileId) -> bool {
        let mut subs = lock(&self.inner.subscriptions);
        match subs.get_mut(&tile) {
            Some(n) if *n > 1 => {
                *n -= 1;
                false
            }
            Some(_) => {
                subs.remove(&tile);
                true
            }
            None => false,
        }
    }

    /// Ends one subscription; the provider stops with the last one.
    pub fn unsubscribe(&self, tile: TileId) {
        if self.release(tile) {
            self.stop(tile);
        }
    }

    /// Tiles with at least one subscriber, i.e. the only ones that may be running.
    pub fn active(&self) -> Vec<TileId> {
        TileId::ALL.into_iter().filter(|t| lock(&self.inner.subscriptions).contains_key(t)).collect()
    }

    /// Stops every provider. Call when the dock quits.
    pub fn shutdown(&self) {
        for tile in TileId::ALL {
            lock(&self.inner.subscriptions).remove(&tile);
            self.stop(tile);
        }
    }

    /// The link that performs `action` for a saved contact, over the first of their ways that can.
    pub(crate) fn contact_link(&self, id: &str, action: ContactAction) -> Result<String, String> {
        self.inner.contacts.link_for_action(id, action)
    }

    /// Files the tiles may open: inside the downloads, screenshots and voice memo folders, or on the shelf.
    fn may_open(&self, path: &str) -> bool {
        let p = Path::new(path);
        [paths::downloads(), paths::screenshots(), paths::voice_memos()].into_iter().flatten().any(|f| is_within(p, &f))
            || self.inner.shelf.contains(path)
    }

    fn checked_path(&self, path: &str) -> Result<PathBuf, String> {
        if self.may_open(path) {
            Ok(PathBuf::from(path))
        } else {
            Err("That file is not one of the dock's files".to_owned())
        }
    }

    pub fn command(&self, command: TileCommand) -> CommandResult {
        use TileCommand::*;
        let i = &self.inner;
        match command {
            AudioSetVolume { volume } => audio::set_volume(volume).into(),
            AudioSetMuted { muted } => audio::set_muted(muted).into(),
            AudioSetDefaultDevice { device_id } => audio::set_default_device(&device_id).into(),
            AudioSetAppVolume { app_id, volume } => audio::set_app_volume(&app_id, volume).into(),
            AudioSetAppMuted { app_id, muted } => audio::set_app_muted(&app_id, muted).into(),
            MicrophoneSetMuted { muted } => microphone::set_muted(muted).into(),
            CalendarSetIcsFile { path } => i.calendar.set_ics_file(path).into(),
            CalendarJoin { url } => calendar::join(&url).into(),
            ClipboardPaste { id } => i.clipboard.paste(id).into(),
            ClipboardPin { id, pinned } => {
                i.clipboard.pin(id, pinned);
                CommandResult::done()
            }
            ClipboardRemove { id } => {
                i.clipboard.remove(id);
                CommandResult::done()
            }
            ClipboardClear => {
                i.clipboard.clear();
                CommandResult::done()
            }
            ClipboardSetPersisted { persisted } => i.clipboard.set_persisted(persisted).into(),
            ScreenshotsCapture { mode, hwnd, rect } => match paths::screenshots() {
                Some(folder) => match screenshots::capture(&folder, mode, hwnd.as_deref(), rect) {
                    Ok(path) => CommandResult::value(serde_json::json!({ "path": path.to_string_lossy() })),
                    Err(e) => CommandResult::failed(e),
                },
                None => CommandResult::failed("Windows did not say where Pictures is"),
            },
            ScreenshotsOpenSnip => shell::open_uri("ms-screenclip:").into(),
            FileOpen { path } => self.checked_path(&path).and_then(|p| shell::open(&p.to_string_lossy())).into(),
            FileReveal { path } => self.checked_path(&path).and_then(|p| shell::reveal(&p)).into(),
            FileThumbnail { path, size } => {
                let result = self.checked_path(&path).and_then(|p| {
                    let modified = std::fs::metadata(&p)
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(0));
                    i.thumbs.get(&p, size, modified)
                });
                match result {
                    Ok(url) => CommandResult::value(serde_json::Value::String(url)),
                    Err(e) => CommandResult::failed(e),
                }
            }
            ShelfAdd { paths } => match i.shelf.add(&paths) {
                Ok(n) => CommandResult::value(serde_json::json!(n)),
                Err(e) => CommandResult::failed(e),
            },
            ShelfRemove { id } => i.shelf.remove(&id).into(),
            ShelfClear => i.shelf.clear().into(),
            TogglesSetWifi { on } => radios::set(radios::Kind::Wifi, on).into(),
            TogglesSetBluetooth { on } => radios::set(radios::Kind::Bluetooth, on).into(),
            TogglesSetBrightness { level } => toggles::brightness::set(level).into(),
            TogglesOpenSettings { page } => shell::open_uri(toggles::system::settings_uri(page)).into(),
            ContactsSave { contact } => i.contacts.save(contact).into(),
            ContactsRemove { id } => i.contacts.remove(&id).into(),
            ContactsLaunch { id, channel, action } => {
                i.contacts.link_for(&id, channel, action).and_then(|uri| shell::open_uri(&uri)).into()
            }
            VoiceMemoRecord => i.voice_memo.start_recording().into(),
            VoiceMemoStop => {
                i.voice_memo.stop_recording();
                CommandResult::done()
            }
            VoiceMemoPlay { path } => i.voice_memo.play(&path).into(),
            VoiceMemoStopPlayback => {
                i.voice_memo.stop_playback();
                CommandResult::done()
            }
            VoiceMemoDelete { path } => i.voice_memo.delete(&path).into(),
            ColourPickStart => i.colour.start_picking().into(),
            ColourPickCancel => {
                i.colour.cancel();
                CommandResult::done()
            }
            ColourCopy { hex } if colour::is_hex_colour(&hex) => clipboard::set_text(&hex).into(),
            ColourCopy { .. } => CommandResult::failed("That is not a #RRGGBB colour"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;

    fn hub() -> (TileHub, std::sync::mpsc::Receiver<TileData>, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let (tx, rx) = channel();
        let hub = TileHub::new(DataDir::at(dir.path()), Emitter::new(move |d| drop(tx.send(d))));
        (hub, rx, dir)
    }

    #[test]
    fn paths_are_checked_the_windows_way() {
        let folder = Path::new(r"C:\Users\me\Downloads");
        assert!(is_within(Path::new(r"c:\users\ME\downloads\a.zip"), folder));
        assert!(is_within(Path::new(r"C:/Users/me/Downloads/sub/a.zip"), folder));
        assert!(!is_within(Path::new(r"C:\Users\me\Downloads\..\Documents\a.zip"), folder));
        assert!(!is_within(Path::new(r"C:\Users\me\Downloads2\a.zip"), folder));
        assert!(!is_within(Path::new(r"C:\Windows\System32\cmd.exe"), folder));
    }

    #[test]
    fn nothing_runs_until_a_tile_is_subscribed() {
        let (hub, _rx, _dir) = hub();
        assert!(hub.active().is_empty());
        hub.subscribe(TileId::Shelf).unwrap();
        hub.subscribe(TileId::Shelf).unwrap();
        assert_eq!(hub.active(), [TileId::Shelf]);
        hub.unsubscribe(TileId::Shelf);
        assert_eq!(hub.active(), [TileId::Shelf], "one subscriber is left");
        hub.unsubscribe(TileId::Shelf);
        assert!(hub.active().is_empty());
        hub.unsubscribe(TileId::Shelf); // a stray extra call is harmless
    }

    #[test]
    fn files_outside_the_dock_folders_are_refused() {
        let (hub, _rx, _dir) = hub();
        assert!(!hub.command(TileCommand::FileOpen { path: r"C:\Windows\System32\cmd.exe".into() }).is_ok());
        assert!(!hub.command(TileCommand::FileReveal { path: r"C:\Windows\notepad.exe".into() }).is_ok());
        assert!(!hub.command(TileCommand::FileThumbnail { path: r"C:\Windows\notepad.exe".into(), size: 64 }).is_ok());
    }

    #[test]
    fn a_shelved_file_can_get_a_thumbnail_and_a_stranger_cannot() {
        let (hub, rx, dir) = hub();
        let file = dir.path().join("note.txt");
        std::fs::write(&file, b"hello").unwrap();
        let path = file.to_string_lossy().into_owned();
        assert!(hub.command(TileCommand::ShelfAdd { paths: vec![path.clone()] }).is_ok());
        assert!(matches!(rx.try_iter().last(), Some(TileData::Shelf(_))));
        let CommandResult::Ok { value: Some(serde_json::Value::String(url)), .. } =
            hub.command(TileCommand::FileThumbnail { path, size: 48 })
        else {
            panic!("a thumbnail was expected");
        };
        assert!(url.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn bad_colours_do_not_reach_the_clipboard() {
        let (hub, _rx, _dir) = hub();
        assert!(!hub.command(TileCommand::ColourCopy { hex: "red".into() }).is_ok());
    }

    #[test]
    fn an_unsafe_contact_link_cannot_be_launched() {
        let (hub, _rx, _dir) = hub();
        assert!(!hub.command(TileCommand::CalendarJoin { url: "https://example.com/".into() }).is_ok());
    }
}
