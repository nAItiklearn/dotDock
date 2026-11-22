/**
 * What the dock's tiles need from the rest of the app, as the UI sees it. The tiles are drawn against these
 * types only; the layer that owns the data (the core, through `tilesProtocol.ts`) maps onto them. Times are
 * epoch milliseconds. Nothing here is computed by the UI that the core knows better (reminder times, the
 * stopwatch's banked time, the audio devices), and nothing is invented: a feed without data says why.
 */

/** Why a feed has no data. The same words the providers use, so a tile has one designed state per reason. */
export type TileIssue = "unsupported" | "no-device" | "offline" | "error" | "needs-setup";

export interface TileFeed<T> {
  readonly data: T | null;
  readonly issue: TileIssue | null;
}

// Quick contacts: people the user picked, and the app each way of reaching them opens.

export type ContactAction = "call" | "video" | "message";

export interface ContactChannel {
  readonly action: ContactAction;
  /** The app that handles it, as the user knows it: "Phone Link", "Teams", "WhatsApp". */
  readonly app: string;
}

export interface Contact {
  readonly id: string;
  readonly name: string;
  /** Only the ways that were set up for this person, in the order they are shown. */
  readonly channels: readonly ContactChannel[];
}

export interface ContactsView {
  readonly contacts: readonly Contact[];
}

// The next meeting.

export interface MeetingView {
  readonly id: string;
  readonly title: string;
  readonly startsAt: number;
  readonly endsAt: number;
  /** "Teams", "Zoom", "Meet": the service of the link, when the event has one. */
  readonly service: string | null;
  /** The link Join opens; null when the event has none, which hides the button. */
  readonly joinUrl: string | null;
  readonly location: string | null;
}

// Stopwatch. Laps are the elapsed time at which each lap was taken.

export interface StopwatchView {
  readonly running: boolean;
  /** When the current run began; null unless running. */
  readonly startedAt: number | null;
  /** Time banked before the current run. */
  readonly bankedMs: number;
  readonly laps: readonly number[];
}

// Microphone.

export interface MicView {
  readonly muted: boolean;
}

// Hydration.

export interface HydrationView {
  readonly goalMl: number;
  readonly loggedMl: number;
  /** What one tap on "log a glass" adds. */
  readonly glassMl: number;
  /** When the next reminder fires; null when reminders are off. */
  readonly nextReminderAt: number | null;
  readonly intervalMinutes: number;
}

// Calendar day.

export interface AgendaEvent {
  readonly id: string;
  readonly title: string;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly allDay: boolean;
  readonly location: string | null;
}

export interface AgendaView {
  /** Midnight at the start of the day shown, local time. */
  readonly day: number;
  readonly events: readonly AgendaEvent[];
}

// Audio output.

export type AudioDeviceKind = "speakers" | "headphones" | "other";

export interface AudioDevice {
  readonly id: string;
  readonly name: string;
  readonly kind: AudioDeviceKind;
  readonly current: boolean;
}

export interface AudioView {
  readonly devices: readonly AudioDevice[];
  /** 0 to 1. */
  readonly volume: number;
  readonly muted: boolean;
}

// Network throughput.

export interface NetworkView {
  /** Bytes received and sent per second, over the last second. */
  readonly downBytesPerSec: number;
  readonly upBytesPerSec: number;
}

// Quick toggles. A switch the machine does not have (no Bluetooth radio, a desktop with no brightness) is null.

export type ToggleName = "wifi" | "bluetooth" | "nightLight" | "doNotDisturb";

export interface TogglesView {
  readonly switches: Readonly<Record<ToggleName, boolean | null>>;
  /** 0 to 1, or null for a display whose brightness cannot be set. */
  readonly brightness: number | null;
}

export type TogglesOp = { readonly type: "switch"; readonly name: ToggleName; readonly on: boolean } | { readonly type: "brightness"; readonly value: number };

// Currency reference rates.

export interface RatesView {
  /** The currency every rate is quoted against: "EUR" for the European Central Bank's rates. */
  readonly base: string;
  /** When the source published these rates. */
  readonly publishedAt: number;
  /** Units of each currency per one unit of the base, by ISO 4217 code. */
  readonly rates: Readonly<Record<string, number>>;
}

/** Every feed the dock reads from the core. Reminders, focus, progress, system and media come from elsewhere in the app. */
export interface TileFeeds {
  readonly contacts: TileFeed<ContactsView>;
  readonly meeting: TileFeed<MeetingView | null>;
  readonly stopwatch: TileFeed<StopwatchView>;
  readonly mic: TileFeed<MicView>;
  readonly hydration: TileFeed<HydrationView>;
  readonly agenda: TileFeed<AgendaView>;
  readonly audio: TileFeed<AudioView>;
  readonly network: TileFeed<NetworkView>;
  readonly toggles: TileFeed<TogglesView>;
  readonly rates: TileFeed<RatesView>;
}

export type FeedName = keyof TileFeeds;

export type StopwatchOp = "start" | "pause" | "lap" | "reset";

export type HydrationOp = { readonly type: "log"; readonly ml: number } | { readonly type: "snooze"; readonly minutes: number };

export type AudioOp =
  | { readonly type: "output"; readonly deviceId: string }
  | { readonly type: "volume"; readonly value: number }
  | { readonly type: "mute"; readonly muted: boolean };

/** What the tiles ask of the core. Every command resolves when it is done and rejects with a readable reason. */
export interface TilesCommands {
  contact(id: string, action: ContactAction): Promise<void>;
  joinMeeting(url: string): Promise<void>;
  stopwatch(op: StopwatchOp): Promise<void>;
  toggleMic(): Promise<void>;
  hydration(op: HydrationOp): Promise<void>;
  audio(op: AudioOp): Promise<void>;
  toggles(op: TogglesOp): Promise<void>;
  /** Opens a web address (http or https only) in the user's default browser. */
  openUrl(url: string): Promise<void>;
}

export type Unsubscribe = () => void;

/** The seam between the tiles and whoever owns their data. */
export interface TilesBackend {
  readonly commands: TilesCommands;
  /**
   * Delivers the current value of each named feed, then every change to it. Only the feeds of tiles that are on the
   * dock are named, so a feed nobody shows costs the core nothing. A new subscription replaces the previous one.
   */
  subscribe(feeds: readonly FeedName[], listener: (changes: Partial<TileFeeds>) => void): Unsubscribe;
  /**
   * The live input level, 0 to 1, a few times a second. Capture runs only while at least one listener is
   * subscribed, which the tile does only while it is on the dock, unmuted and the dock is awake.
   */
  watchMicLevel(listener: (level: number) => void): Unsubscribe;
}
