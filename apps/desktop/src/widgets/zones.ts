import { CITIES, cityById, type City } from "./data/cities";
import { MS_PER_DAY, MS_PER_MINUTE } from "./format";

/** Wall-clock fields of an instant in some time zone. `month` is 0 to 11 like Date. */
export interface ZonedFields {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  /** 0 = Sunday. */
  readonly weekday: number;
}

export function localFields(date: Date): ZonedFields {
  return {
    year: date.getFullYear(),
    month: date.getMonth(),
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
    weekday: date.getDay(),
  };
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Wall-clock fields of `date` in an IANA time zone, without building a shifted Date (no DST gaps). */
export function zonedFields(date: Date, timeZone: string): ZonedFields {
  const parts = formatterFor(timeZone).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value);
  const year = read("year");
  const month = read("month") - 1;
  const day = read("day");
  return {
    year,
    month,
    day,
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
    weekday: new Date(Date.UTC(year, month, day)).getUTCDay(),
  };
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function fieldsDayDifference(from: ZonedFields, to: ZonedFields): number {
  const a = Date.UTC(from.year, from.month, from.day);
  const b = Date.UTC(to.year, to.month, to.day);
  return Math.round((b - a) / MS_PER_DAY);
}

/** UTC offset of a zone at an instant, in minutes (east is positive). */
export function utcOffsetMinutes(date: Date, timeZone: string): number {
  const f = zonedFields(date, timeZone);
  const asUtc = Date.UTC(f.year, f.month, f.day, f.hour, f.minute, f.second);
  const truncated = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((asUtc - truncated) / MS_PER_MINUTE);
}

/** "UTC+5:30", "UTC-8", "UTC". */
export function formatUtcOffset(minutes: number): string {
  if (minutes === 0) return "UTC";
  const sign = minutes > 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m === 0 ? `UTC${sign}${h}` : `UTC${sign}${h}:${m.toString().padStart(2, "0")}`;
}

/** The device's own zone id, e.g. "Asia/Kolkata". */
export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export const LOCAL_ZONE = "local";

export interface ResolvedZone {
  readonly id: string;
  readonly name: string;
  readonly timeZone: string;
  /** Null for the device zone when no bundled city shares it: day/night then falls back to the hour. */
  readonly coords: Pick<City, "lat" | "lon"> | null;
}

/** "Asia/Kolkata" becomes "Kolkata". */
function nameFromZoneId(timeZone: string): string {
  const leaf = timeZone.split("/").pop() ?? timeZone;
  return leaf.replaceAll("_", " ");
}

/** Resolves a city id, or "local" for the device zone, to a zone the widgets can render. */
export function resolveZone(id: string, systemZone: string = systemTimeZone()): ResolvedZone {
  const city = id === LOCAL_ZONE ? undefined : cityById(id);
  if (city) return { id: city.id, name: city.name, timeZone: city.timeZone, coords: { lat: city.lat, lon: city.lon } };
  // Any bundled city in the same zone is close enough in longitude for a day/night dot.
  const sibling = CITIES.find((c) => c.timeZone === systemZone);
  return {
    id: LOCAL_ZONE,
    name: nameFromZoneId(systemZone),
    timeZone: systemZone,
    coords: sibling ? { lat: sibling.lat, lon: sibling.lon } : null,
  };
}
