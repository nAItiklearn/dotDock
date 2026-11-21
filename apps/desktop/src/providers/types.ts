/** Typed payloads pushed by providers. Mirrors the Rust structs in src-tauri/src/providers. */

export interface BatteryData {
  readonly percent: number;
  readonly charging: boolean;
  /**
   * On AC power. Can be true while not charging: full, or a charge limit such as a laptop's
   * conservation mode. Optional only so caches from older versions still parse.
   */
  readonly pluggedIn?: boolean;
  /** Seconds until empty (discharging) or full (charging); null when Windows does not know. */
  readonly secondsRemaining: number | null;
}

export interface DiskData {
  readonly mount: string;
  readonly totalBytes: number;
  readonly usedBytes: number;
}

export interface SystemData {
  readonly memTotalBytes: number;
  readonly memUsedBytes: number;
  readonly cpuPercent: number;
  readonly disks: readonly DiskData[];
}

export interface WeatherData {
  readonly place: string;
  readonly temperatureC: number;
  readonly highC: number;
  readonly lowC: number;
  /** WMO weather interpretation code from Open-Meteo. */
  readonly code: number;
  readonly isDay: boolean;
  readonly fetchedAt: number;
}

/** The system media session (Spotify, browsers, players). Absent when nothing is playing. */
export interface MediaData {
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  /** Cover art as a data URL (`data:image/...;base64,...`), or null when the session has none. */
  readonly artwork: string | null;
  /** Playback position in seconds, as it was when this payload was sent. */
  readonly positionSec: number;
  /** Track length in seconds; 0 for live streams and sources that do not report one. */
  readonly durationSec: number;
  readonly playing: boolean;
  readonly canSeek: boolean;
  readonly canNext: boolean;
  readonly canPrev: boolean;
}

/** Commands the media widget sends back to the core. The Rust side owns the `media_command` handler. */
export type MediaCommand =
  | { readonly action: "toggle" }
  | { readonly action: "next" }
  | { readonly action: "previous" }
  | { readonly action: "seek"; readonly positionSec: number };

export interface ProviderPayloads {
  battery: BatteryData;
  system: SystemData;
  weather: WeatherData;
  media: MediaData;
}

export type ProviderName = keyof ProviderPayloads;

/** Why a provider has no live data. Each one has a designed widget state. */
export type ProviderIssue = "unsupported" | "no-device" | "offline" | "error" | "needs-setup";

export interface ProviderState<T> {
  readonly data: T | null;
  /** True while showing a cached value that has not been confirmed live yet. */
  readonly stale: boolean;
  readonly issue: ProviderIssue | null;
}
