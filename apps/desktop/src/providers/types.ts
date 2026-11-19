/** Typed payloads pushed by providers. Mirrors the Rust structs in src-tauri/src/providers. */

export interface BatteryData {
  readonly percent: number;
  readonly charging: boolean;
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

export interface ProviderPayloads {
  battery: BatteryData;
  system: SystemData;
  weather: WeatherData;
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
