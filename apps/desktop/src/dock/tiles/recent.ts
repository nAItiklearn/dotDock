/** The apps opened from the dock, newest first: the History tile. Kept on this device only. */
export const RECENT_KEY = "dotdock.dock.recent";
export const MAX_RECENT = 8;

export interface RecentLaunch {
  readonly appId: string;
  readonly at: number;
}

/** The list with `appId` moved to the front at `at`, trimmed to the most it keeps. */
export function pushLaunch(list: readonly RecentLaunch[], appId: string, at: number): RecentLaunch[] {
  return [{ appId, at }, ...list.filter((r) => r.appId !== appId)].slice(0, MAX_RECENT);
}

const isLaunch = (r: unknown): r is RecentLaunch =>
  typeof r === "object" && r !== null && typeof (r as RecentLaunch).appId === "string" && Number.isFinite((r as RecentLaunch).at);

export function parseRecentLaunches(raw: string | null): RecentLaunch[] {
  try {
    const value: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const unique: RecentLaunch[] = [];
    for (const r of value) {
      if (!isLaunch(r) || seen.has(r.appId)) continue;
      seen.add(r.appId);
      unique.push({ appId: r.appId, at: r.at });
    }
    return unique.slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export type AgoUnit = "now" | "min" | "h" | "d";

/** How long ago, in the compact units a list row has room for. */
export function agoParts(at: number, now: number): { readonly unit: AgoUnit; readonly count: number } {
  const ms = Math.max(0, now - at);
  if (ms < MIN) return { unit: "now", count: 0 };
  if (ms < HOUR) return { unit: "min", count: Math.floor(ms / MIN) };
  if (ms < DAY) return { unit: "h", count: Math.floor(ms / HOUR) };
  return { unit: "d", count: Math.floor(ms / DAY) };
}
