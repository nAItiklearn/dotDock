//! Wire types for the dock's live tiles. Mirrors `apps/desktop/src/dock/tilesProtocol.ts`: change both together.
//!
//! Every struct serialises as camelCase. Percentages are scalars in `0.0..=1.0`; times are Unix milliseconds.

use serde::{Deserialize, Serialize};

/// Event the host forwards to the dock window; the payload is a [`TileData`].
pub const EVENT_DATA: &str = "tiles://data";

/// One live tile's data source. A tile is *subscribed* while the dock shows it, and its provider runs only then.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum TileId {
    Audio,
    Microphone,
    /// Live input level of the default microphone. Opens a capture stream, so subscribe only while it is on screen.
    MicrophoneLevel,
    Calendar,
    Clipboard,
    Screenshots,
    Downloads,
    Shelf,
    Toggles,
    SystemHistory,
    Contacts,
    VoiceMemo,
    ColourPicker,
}

impl TileId {
    pub const ALL: [TileId; 13] = [
        TileId::Audio,
        TileId::Microphone,
        TileId::MicrophoneLevel,
        TileId::Calendar,
        TileId::Clipboard,
        TileId::Screenshots,
        TileId::Downloads,
        TileId::Shelf,
        TileId::Toggles,
        TileId::SystemHistory,
        TileId::Contacts,
        TileId::VoiceMemo,
        TileId::ColourPicker,
    ];
}

/// The data of one tile, pushed on `tiles://data` and returned by `tiles_subscribe`.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "tile", content = "data", rename_all = "kebab-case")]
pub enum TileData {
    Audio(AudioState),
    Microphone(MicrophoneState),
    MicrophoneLevel(MicrophoneLevel),
    Calendar(CalendarState),
    Clipboard(ClipboardState),
    Screenshots(FolderState),
    Downloads(FolderState),
    Shelf(ShelfState),
    Toggles(TogglesState),
    SystemHistory(SystemHistory),
    Contacts(ContactsState),
    VoiceMemo(VoiceMemoState),
    ColourPicker(ColourPickerState),
}

impl TileData {
    pub fn tile(&self) -> TileId {
        match self {
            TileData::Audio(_) => TileId::Audio,
            TileData::Microphone(_) => TileId::Microphone,
            TileData::MicrophoneLevel(_) => TileId::MicrophoneLevel,
            TileData::Calendar(_) => TileId::Calendar,
            TileData::Clipboard(_) => TileId::Clipboard,
            TileData::Screenshots(_) => TileId::Screenshots,
            TileData::Downloads(_) => TileId::Downloads,
            TileData::Shelf(_) => TileId::Shelf,
            TileData::Toggles(_) => TileId::Toggles,
            TileData::SystemHistory(_) => TileId::SystemHistory,
            TileData::Contacts(_) => TileId::Contacts,
            TileData::VoiceMemo(_) => TileId::VoiceMemo,
            TileData::ColourPicker(_) => TileId::ColourPicker,
        }
    }
}

// ---------------------------------------------------------------- audio

/// What a playback or capture endpoint is, from its Windows form factor, so the UI can pick an icon.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum DeviceKind {
    Speakers,
    Headphones,
    Headset,
    Microphone,
    Hdmi,
    Digital,
    Other,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    /// Windows endpoint id, the argument of `audioSetDefaultDevice`.
    pub id: String,
    pub name: String,
    pub kind: DeviceKind,
    pub is_default: bool,
}

/// An app that has an audio session, grouped by executable the way the Windows volume mixer groups them.
#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AudioApp {
    /// Lower-cased executable path, or `system-sounds`.
    pub id: String,
    pub name: String,
    pub exe_path: Option<String>,
    pub volume: f32,
    pub muted: bool,
    /// The app is producing sound right now.
    pub active: bool,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AudioState {
    /// False when Windows has no active playback device.
    pub available: bool,
    pub volume: f32,
    pub muted: bool,
    pub devices: Vec<AudioDevice>,
    pub apps: Vec<AudioApp>,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MicrophoneState {
    /// False when Windows has no active capture device.
    pub available: bool,
    pub device_name: Option<String>,
    pub muted: bool,
    pub volume: f32,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MicrophoneLevel {
    /// Peak of the last sampling interval, 0 to 1 (linear amplitude, not dB).
    pub peak: f32,
    /// The microphone is being read. False while muted, because the stream is closed then.
    pub listening: bool,
    /// Why the microphone could not be opened (privacy setting, in use exclusively), for a tooltip.
    pub problem: Option<String>,
}

// ---------------------------------------------------------------- calendar

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum CalendarSource {
    /// Windows' appointment store (accounts added in Windows settings).
    Windows,
    /// A local `.ics` file the user picked.
    IcsFile,
    None,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum MeetingService {
    Teams,
    Zoom,
    Meet,
    Webex,
    Other,
}

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MeetingLink {
    pub service: MeetingService,
    pub url: String,
}

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub id: String,
    pub title: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub all_day: bool,
    pub location: Option<String>,
    pub calendar: Option<String>,
    pub join: Option<MeetingLink>,
}

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CalendarState {
    pub source: CalendarSource,
    /// Why there are no events when the source is `none`, or why the Windows store could not be read.
    pub problem: Option<String>,
    /// Path of the chosen `.ics` file, when there is one.
    pub ics_path: Option<String>,
    /// Events from the start of today to seven days ahead, soonest first.
    pub events: Vec<CalendarEvent>,
}

// ---------------------------------------------------------------- clipboard

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum ClipKind {
    Text,
    Image,
}

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClipEntry {
    pub id: u64,
    pub at_ms: i64,
    pub kind: ClipKind,
    /// First characters of the text, or a short description of the image.
    pub preview: String,
    /// Characters of text, or pixels of an image.
    pub size: u64,
    pub pinned: bool,
    /// `data:image/png` thumbnail, images only.
    pub thumbnail: Option<String>,
    /// Name of the app that put it on the clipboard, when Windows tells us.
    pub source: Option<String>,
}

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardState {
    pub entries: Vec<ClipEntry>,
    /// History is also kept encrypted on disk (Windows DPAPI, this user only). Off by default.
    pub persisted: bool,
}

// ---------------------------------------------------------------- folders: screenshots and downloads

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileItem {
    pub path: String,
    pub name: String,
    pub modified_ms: i64,
    pub size_bytes: u64,
    /// Still being written by a browser or downloader (`.crdownload`, `.part`, `.tmp`, ...).
    pub partial: bool,
}

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FolderState {
    pub folder: String,
    /// Newest first.
    pub items: Vec<FileItem>,
    pub problem: Option<String>,
}

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ShelfItem {
    pub id: String,
    pub path: String,
    pub name: String,
    pub added_ms: i64,
    /// False when the file or folder was moved or deleted since it was shelved.
    pub exists: bool,
    pub is_dir: bool,
}

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ShelfState {
    pub items: Vec<ShelfItem>,
}

// ---------------------------------------------------------------- quick toggles

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Toggle {
    /// The device exists and Windows lets us read it.
    pub available: bool,
    /// None when the state cannot be read.
    pub on: Option<bool>,
    /// Why it is unavailable, in one sentence for a tooltip.
    pub problem: Option<String>,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Brightness {
    pub available: bool,
    /// 0 to 1 of the panel's range.
    pub level: f32,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TogglesState {
    pub wifi: Toggle,
    pub bluetooth: Toggle,
    pub brightness: Brightness,
    /// Read only: Windows has no documented way to switch it, so the tile opens the Settings page.
    pub night_light: Toggle,
    /// Read only, same reason.
    pub do_not_disturb: Toggle,
}

// ---------------------------------------------------------------- system history

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SystemHistory {
    /// Seconds between samples.
    pub interval_secs: u64,
    /// CPU load, 0 to 1. Oldest first; at most `capacity` samples.
    pub cpu: Vec<f32>,
    /// Memory in use as a share of RAM.
    pub memory: Vec<f32>,
    /// Busy time of the physical disks, 0 to 1.
    pub disk: Vec<f32>,
    /// Bytes per second received, all network adapters.
    pub net_down: Vec<f64>,
    pub net_up: Vec<f64>,
    pub capacity: usize,
    pub memory_used_bytes: u64,
    pub memory_total_bytes: u64,
}

// ---------------------------------------------------------------- contacts

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum Channel {
    /// Phone Link or another `tel:` handler.
    Phone,
    Teams,
    Zoom,
    Whatsapp,
    Discord,
    Email,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum ContactAction {
    Call,
    Video,
    Message,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Handle {
    pub channel: Channel,
    /// Phone number, email address, Zoom personal meeting id or Discord user id, depending on the channel.
    pub value: String,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Contact {
    pub id: String,
    pub name: String,
    pub handles: Vec<Handle>,
}

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ContactsState {
    pub contacts: Vec<Contact>,
}

// ---------------------------------------------------------------- voice memo

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Memo {
    pub path: String,
    pub name: String,
    pub created_ms: i64,
    pub duration_ms: u64,
    pub size_bytes: u64,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    pub started_ms: i64,
    /// Peak of the last interval, 0 to 1.
    pub peak: f32,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Playback {
    pub path: String,
    pub started_ms: i64,
    pub duration_ms: u64,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VoiceMemoState {
    pub folder: String,
    /// Newest first.
    pub memos: Vec<Memo>,
    pub recording: Option<Recording>,
    pub playing: Option<Playback>,
    pub problem: Option<String>,
}

// ---------------------------------------------------------------- colour picker

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    /// Physical screen pixel under the cursor.
    pub x: i32,
    pub y: i32,
    /// `#RRGGBB`.
    pub hex: String,
}

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ColourPickerState {
    pub picking: bool,
    /// Pixel under the cursor while picking.
    pub current: Option<Sample>,
    /// Magnifier: a `LOUPE_SIDE` x `LOUPE_SIDE` square of `#RRGGBB` around the cursor, row by row. Empty when not picking.
    pub loupe: Vec<String>,
    /// Colours picked so far, newest first.
    pub history: Vec<String>,
}

// ---------------------------------------------------------------- commands

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum CaptureMode {
    /// The monitor under the cursor.
    Screen,
    /// A window by handle.
    Window,
    /// A rectangle in physical screen pixels.
    Region,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum SettingsPage {
    NightLight,
    DoNotDisturb,
    Sound,
    Bluetooth,
    Wifi,
    Display,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PixelRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// What the dock asks a provider to do.
#[derive(Deserialize, Clone, Debug)]
#[serde(tag = "command", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum TileCommand {
    AudioSetVolume {
        volume: f32,
    },
    AudioSetMuted {
        muted: bool,
    },
    AudioSetDefaultDevice {
        device_id: String,
    },
    AudioSetAppVolume {
        app_id: String,
        volume: f32,
    },
    AudioSetAppMuted {
        app_id: String,
        muted: bool,
    },
    MicrophoneSetMuted {
        muted: bool,
    },
    CalendarSetIcsFile {
        path: Option<String>,
    },
    /// Open a meeting link in its app or the browser.
    CalendarJoin {
        url: String,
    },
    ClipboardPaste {
        id: u64,
    },
    ClipboardPin {
        id: u64,
        pinned: bool,
    },
    ClipboardRemove {
        id: u64,
    },
    ClipboardClear,
    ClipboardSetPersisted {
        persisted: bool,
    },
    ScreenshotsCapture {
        mode: CaptureMode,
        hwnd: Option<String>,
        rect: Option<PixelRect>,
    },
    /// Open Windows' own snipping overlay (Win+Shift+S); the result lands in the clipboard and the watched folder.
    ScreenshotsOpenSnip,
    FileOpen {
        path: String,
    },
    FileReveal {
        path: String,
    },
    /// Reply `value` is a `data:image/png` URL of the file's thumbnail or icon.
    FileThumbnail {
        path: String,
        size: u32,
    },
    ShelfAdd {
        paths: Vec<String>,
    },
    ShelfRemove {
        id: String,
    },
    ShelfClear,
    TogglesSetWifi {
        on: bool,
    },
    TogglesSetBluetooth {
        on: bool,
    },
    TogglesSetBrightness {
        level: f32,
    },
    TogglesOpenSettings {
        page: SettingsPage,
    },
    ContactsSave {
        contact: Contact,
    },
    ContactsRemove {
        id: String,
    },
    ContactsLaunch {
        id: String,
        channel: Channel,
        action: ContactAction,
    },
    VoiceMemoRecord,
    VoiceMemoStop,
    VoiceMemoPlay {
        path: String,
    },
    VoiceMemoStopPlayback,
    VoiceMemoDelete {
        path: String,
    },
    ColourPickStart,
    ColourPickCancel,
    ColourCopy {
        hex: String,
    },
}

/// Result of `tiles_command`: `value` carries data for the few commands that return some.
#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(untagged)]
pub enum CommandResult {
    Ok { ok: bool, value: Option<serde_json::Value> },
    Failed { ok: bool, reason: String },
}

impl CommandResult {
    pub fn done() -> Self {
        CommandResult::Ok { ok: true, value: None }
    }

    pub fn value(value: serde_json::Value) -> Self {
        CommandResult::Ok { ok: true, value: Some(value) }
    }

    pub fn failed(reason: impl Into<String>) -> Self {
        CommandResult::Failed { ok: false, reason: reason.into() }
    }

    pub fn is_ok(&self) -> bool {
        matches!(self, CommandResult::Ok { .. })
    }
}

impl From<Result<(), String>> for CommandResult {
    fn from(r: Result<(), String>) -> Self {
        match r {
            Ok(()) => CommandResult::done(),
            Err(reason) => CommandResult::failed(reason),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn tile_data_is_adjacently_tagged_in_kebab_case() {
        let v = serde_json::to_value(TileData::MicrophoneLevel(MicrophoneLevel {
            peak: 0.5,
            listening: true,
            problem: None,
        }))
        .unwrap();
        assert_eq!(
            v,
            json!({ "tile": "microphone-level", "data": { "peak": 0.5, "listening": true, "problem": null } })
        );
    }

    #[test]
    fn commands_parse_from_camel_case_json() {
        let c: TileCommand =
            serde_json::from_value(json!({ "command": "audioSetAppVolume", "appId": "x", "volume": 0.3 })).unwrap();
        assert!(matches!(c, TileCommand::AudioSetAppVolume { ref app_id, volume } if app_id == "x" && volume == 0.3));
        let c: TileCommand = serde_json::from_value(json!({ "command": "clipboardClear" })).unwrap();
        assert!(matches!(c, TileCommand::ClipboardClear));
    }

    #[test]
    fn results_serialise_as_ok_or_failed() {
        assert_eq!(serde_json::to_value(CommandResult::done()).unwrap(), json!({ "ok": true, "value": null }));
        assert_eq!(serde_json::to_value(CommandResult::failed("no")).unwrap(), json!({ "ok": false, "reason": "no" }));
    }

    #[test]
    fn every_tile_id_round_trips() {
        for t in TileId::ALL {
            let s = serde_json::to_string(&t).unwrap();
            assert_eq!(serde_json::from_str::<TileId>(&s).unwrap(), t);
        }
    }
}
