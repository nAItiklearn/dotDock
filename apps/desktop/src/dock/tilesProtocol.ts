/**
 * The contract between the dock's native tile providers (crate `dotdock-tiles`, `TileHub`) and the dock window.
 * Rust mirrors every type with serde camelCase in `src-tauri/tiles/src/protocol.rs`: change both together.
 * What each tile reads, when it runs and what was measured is in `docs/dock/TILES.md`.
 *
 * Model: the dock window *subscribes* to a tile while it shows it and *unsubscribes* when it does not. A
 * provider runs only between its first subscription and its last unsubscription, and pushes its data on
 * `tiles://data` whenever it changes. Nothing polls.
 */

/** Event the host forwards from the native side; the payload is a `TileData`. */
export const TILES_EVENT = "tiles://data";

/** Tauri commands the host exposes (all resolve; failures are `{ ok: false, reason }`). */
export interface TilesCommands {
  /** Starts the tile's provider if needed and returns its current data. */
  tiles_subscribe(args: { tile: TileId }): TilesSubscribeResult;
  tiles_unsubscribe(args: { tile: TileId }): void;
  tiles_command(args: { command: TileCommand }): TileCommandResult;
}

export type TilesSubscribeResult = { readonly ok: true; readonly data: TileData } | { readonly ok: false; readonly reason: string };

export type TileId =
  | "audio"
  | "microphone"
  /** Live microphone level. Opens a capture stream (Windows shows its microphone indicator): subscribe only while visible. */
  | "microphone-level"
  | "calendar"
  | "clipboard"
  | "screenshots"
  | "downloads"
  | "shelf"
  | "toggles"
  | "system-history"
  | "contacts"
  | "voice-memo"
  | "colour-picker";

/** Percentages are scalars 0 to 1; times are Unix milliseconds. */
export type TileData =
  | { readonly tile: "audio"; readonly data: AudioState }
  | { readonly tile: "microphone"; readonly data: MicrophoneState }
  | { readonly tile: "microphone-level"; readonly data: MicrophoneLevel }
  | { readonly tile: "calendar"; readonly data: CalendarState }
  | { readonly tile: "clipboard"; readonly data: ClipboardState }
  | { readonly tile: "screenshots"; readonly data: FolderState }
  | { readonly tile: "downloads"; readonly data: FolderState }
  | { readonly tile: "shelf"; readonly data: ShelfState }
  | { readonly tile: "toggles"; readonly data: TogglesState }
  | { readonly tile: "system-history"; readonly data: SystemHistory }
  | { readonly tile: "contacts"; readonly data: ContactsState }
  | { readonly tile: "voice-memo"; readonly data: VoiceMemoState }
  | { readonly tile: "colour-picker"; readonly data: ColourPickerState };

// ---------------------------------------------------------------- audio

export type DeviceKind = "speakers" | "headphones" | "headset" | "microphone" | "hdmi" | "digital" | "other";

export interface AudioDevice {
  /** Windows endpoint id, the argument of `audioSetDefaultDevice`. */
  readonly id: string;
  readonly name: string;
  readonly kind: DeviceKind;
  readonly isDefault: boolean;
}

/** An app with an audio session, grouped by executable like the Windows volume mixer. */
export interface AudioApp {
  /** Lower-cased executable path, or `system-sounds`. */
  readonly id: string;
  readonly name: string;
  /** Ask the dock's icon service for this path's icon. */
  readonly exePath: string | null;
  readonly volume: number;
  readonly muted: boolean;
  /** Producing sound right now. */
  readonly active: boolean;
}

export interface AudioState {
  /** False when Windows has no active playback device. */
  readonly available: boolean;
  readonly volume: number;
  readonly muted: boolean;
  readonly devices: readonly AudioDevice[];
  readonly apps: readonly AudioApp[];
}

export interface MicrophoneState {
  readonly available: boolean;
  readonly deviceName: string | null;
  readonly muted: boolean;
  readonly volume: number;
}

export interface MicrophoneLevel {
  /** Peak of the last interval, 0 to 1 linear amplitude. */
  readonly peak: number;
  /** The stream is open. False while the microphone is muted (the stream is closed then) or could not be opened. */
  readonly listening: boolean;
  /** Why it could not be opened, e.g. Windows' microphone privacy switch is off. For a tooltip. */
  readonly problem: string | null;
}

// ---------------------------------------------------------------- calendar

export type CalendarSource = "windows" | "ics-file" | "none";
export type MeetingService = "teams" | "zoom" | "meet" | "webex" | "other";

export interface MeetingLink {
  readonly service: MeetingService;
  readonly url: string;
}

export interface CalendarEvent {
  readonly id: string;
  readonly title: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly allDay: boolean;
  readonly location: string | null;
  readonly calendar: string | null;
  /** Present when the event has an online-meeting link: show a Join button. */
  readonly join: MeetingLink | null;
}

export interface CalendarState {
  readonly source: CalendarSource;
  /** Why there is nothing to show (no account in Windows, unreadable file). Show it with the empty state. */
  readonly problem: string | null;
  readonly icsPath: string | null;
  /** From the start of today to seven days ahead, soonest first. */
  readonly events: readonly CalendarEvent[];
}

// ---------------------------------------------------------------- clipboard

export type ClipKind = "text" | "image";

export interface ClipEntry {
  readonly id: number;
  readonly atMs: number;
  readonly kind: ClipKind;
  /** First characters of text, or "Image 800 x 600". */
  readonly preview: string;
  readonly size: number;
  readonly pinned: boolean;
  /** `data:image/png` thumbnail, images only. */
  readonly thumbnail: string | null;
  readonly source: string | null;
}

export interface ClipboardState {
  readonly entries: readonly ClipEntry[];
  /** History is also kept encrypted on disk. Off by default. */
  readonly persisted: boolean;
}

// ---------------------------------------------------------------- folders

export interface FileItem {
  readonly path: string;
  readonly name: string;
  readonly modifiedMs: number;
  readonly sizeBytes: number;
  readonly isDir: boolean;
  /** Still being written (`.crdownload`, `.part`, ...). */
  readonly partial: boolean;
}

/** Downloads and screenshots: newest first. */
export interface FolderState {
  readonly folder: string;
  readonly items: readonly FileItem[];
  readonly problem: string | null;
}

export interface ShelfItem {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly addedMs: number;
  /** False when the file was moved or deleted after it was shelved. */
  readonly exists: boolean;
  readonly isDir: boolean;
}

export interface ShelfState {
  readonly items: readonly ShelfItem[];
}

// ---------------------------------------------------------------- quick toggles

export interface Toggle {
  readonly available: boolean;
  /** Null when the state cannot be read. */
  readonly on: boolean | null;
  readonly problem: string | null;
}

export interface Brightness {
  readonly available: boolean;
  readonly level: number;
}

export interface TogglesState {
  readonly wifi: Toggle;
  readonly bluetooth: Toggle;
  readonly brightness: Brightness;
  /** Read only: Windows has no documented switch, so the tile opens the Settings page (`togglesOpenSettings`). */
  readonly nightLight: Toggle;
  /** Read only, same reason. */
  readonly doNotDisturb: Toggle;
}

// ---------------------------------------------------------------- system history

export interface SystemHistory {
  readonly intervalSecs: number;
  /** Oldest first; at most `capacity` samples each. */
  readonly cpu: readonly number[];
  readonly memory: readonly number[];
  readonly disk: readonly number[];
  /** Bytes per second. */
  readonly netDown: readonly number[];
  readonly netUp: readonly number[];
  readonly capacity: number;
  readonly memoryUsedBytes: number;
  readonly memoryTotalBytes: number;
}

// ---------------------------------------------------------------- contacts

export type Channel = "phone" | "teams" | "zoom" | "whatsapp" | "discord" | "email";
export type ContactAction = "call" | "video" | "message";

export interface Handle {
  readonly channel: Channel;
  /** Phone number with country code, email address, Zoom meeting id or Discord user id, by channel. */
  readonly value: string;
}

export interface Contact {
  /** Empty when saving a new contact: the host assigns one. */
  readonly id: string;
  readonly name: string;
  readonly handles: readonly Handle[];
}

export interface ContactsState {
  readonly contacts: readonly Contact[];
}

// ---------------------------------------------------------------- voice memo

export interface Memo {
  readonly path: string;
  readonly name: string;
  readonly createdMs: number;
  readonly durationMs: number;
  readonly sizeBytes: number;
}

export interface VoiceMemoState {
  readonly folder: string;
  /** Newest first. */
  readonly memos: readonly Memo[];
  readonly recording: { readonly startedMs: number; readonly peak: number } | null;
  readonly playing: { readonly path: string; readonly startedMs: number; readonly durationMs: number } | null;
  readonly problem: string | null;
}

// ---------------------------------------------------------------- colour picker

export interface Sample {
  /** Physical screen pixel under the cursor. */
  readonly x: number;
  readonly y: number;
  /** `#RRGGBB`. */
  readonly hex: string;
}

/** Side of the magnifier square in `loupe`. */
export const LOUPE_SIDE = 9;

export interface ColourPickerState {
  readonly picking: boolean;
  readonly current: Sample | null;
  /** `LOUPE_SIDE` x `LOUPE_SIDE` hex colours around the cursor, row by row. Empty when not picking. */
  readonly loupe: readonly string[];
  /** Newest first. */
  readonly history: readonly string[];
}

// ---------------------------------------------------------------- commands

export type CaptureMode = "screen" | "window" | "region";
export type SettingsPage = "night-light" | "do-not-disturb" | "sound" | "bluetooth" | "wifi" | "display";

export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Everything the dock can ask a provider to do. Blocking on the native side: never call from the UI thread. */
export type TileCommand =
  | { readonly command: "audioSetVolume"; readonly volume: number }
  | { readonly command: "audioSetMuted"; readonly muted: boolean }
  | { readonly command: "audioSetDefaultDevice"; readonly deviceId: string }
  | { readonly command: "audioSetAppVolume"; readonly appId: string; readonly volume: number }
  | { readonly command: "audioSetAppMuted"; readonly appId: string; readonly muted: boolean }
  | { readonly command: "microphoneSetMuted"; readonly muted: boolean }
  /** Choose the `.ics` file the calendar reads, or `null` to go back to Windows' calendar. */
  | { readonly command: "calendarSetIcsFile"; readonly path: string | null }
  /** Opens a meeting link, only one the calendar itself reported. */
  | { readonly command: "calendarJoin"; readonly url: string }
  | { readonly command: "clipboardPaste"; readonly id: number }
  | { readonly command: "clipboardPin"; readonly id: number; readonly pinned: boolean }
  | { readonly command: "clipboardRemove"; readonly id: number }
  | { readonly command: "clipboardClear" }
  | { readonly command: "clipboardSetPersisted"; readonly persisted: boolean }
  /** Reply `value` is `{ path }` of the PNG saved in Pictures\Screenshots. */
  | { readonly command: "screenshotsCapture"; readonly mode: CaptureMode; readonly hwnd?: string | null; readonly rect?: PixelRect | null }
  | { readonly command: "screenshotsOpenSnip" }
  /** Only files in Downloads, Screenshots, Voice memos or on the shelf. */
  | { readonly command: "fileOpen"; readonly path: string }
  | { readonly command: "fileReveal"; readonly path: string }
  /** Reply `value` is a `data:image/png` URL of the file's thumbnail or icon. */
  | { readonly command: "fileThumbnail"; readonly path: string; readonly size: number }
  /** Reply `value` is how many were added. */
  | { readonly command: "shelfAdd"; readonly paths: readonly string[] }
  | { readonly command: "shelfRemove"; readonly id: string }
  | { readonly command: "shelfClear" }
  | { readonly command: "togglesSetWifi"; readonly on: boolean }
  | { readonly command: "togglesSetBluetooth"; readonly on: boolean }
  /** Takes about a second on many laptops (the display driver is slow): send on release or at most once a second. */
  | { readonly command: "togglesSetBrightness"; readonly level: number }
  | { readonly command: "togglesOpenSettings"; readonly page: SettingsPage }
  | { readonly command: "contactsSave"; readonly contact: Contact }
  | { readonly command: "contactsRemove"; readonly id: string }
  | { readonly command: "contactsLaunch"; readonly id: string; readonly channel: Channel; readonly action: ContactAction }
  | { readonly command: "voiceMemoRecord" }
  | { readonly command: "voiceMemoStop" }
  | { readonly command: "voiceMemoPlay"; readonly path: string }
  | { readonly command: "voiceMemoStopPlayback" }
  /** Moves the memo to the Recycle Bin. */
  | { readonly command: "voiceMemoDelete"; readonly path: string }
  | { readonly command: "colourPickStart" }
  | { readonly command: "colourPickCancel" }
  | { readonly command: "colourCopy"; readonly hex: string };

export type TileCommandResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };
