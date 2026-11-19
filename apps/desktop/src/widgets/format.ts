/** Pure formatting helpers shared by the time-based widgets. Everything locale-aware goes through Intl. */

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_ON_FACE = 12;

export const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;
export const MS_PER_HOUR = MINUTES_PER_HOUR * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

export const pad2 = (n: number): string => Math.trunc(n).toString().padStart(2, "0");

/** True when the user's locale shows a 24-hour clock by default. */
export function prefers24Hour(locale?: string): boolean {
  const cycle = new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hourCycle;
  return cycle === "h23" || cycle === "h24";
}

export interface ClockFormat {
  readonly hour24: boolean;
  /** "09:05" instead of "9:05". */
  readonly leadingZero: boolean;
}

export interface ClockParts {
  readonly hours: string;
  readonly minutes: string;
  readonly seconds: string;
  /** "AM"/"PM" in a 12-hour clock, otherwise null. Locale markers are not used: this is a display numeral. */
  readonly meridiem: "AM" | "PM" | null;
}

/** Wall-clock time of day, from either the device or a time zone. */
export interface TimeFields {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

export function clockParts({ hour, minute, second }: TimeFields, { hour24, leadingZero }: ClockFormat): ClockParts {
  const shown = hour24 ? hour : hour % HOURS_ON_FACE || HOURS_ON_FACE;
  return {
    hours: leadingZero ? pad2(shown) : shown.toString(),
    minutes: pad2(minute),
    seconds: pad2(second),
    meridiem: hour24 ? null : hour < HOURS_ON_FACE ? "AM" : "PM",
  };
}

/** Elapsed or remaining time: "04:07", or "1:04:07" from one hour up. Negative values read as zero. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / MS_PER_SECOND));
  const h = Math.floor(total / (SECONDS_PER_MINUTE * MINUTES_PER_HOUR));
  const m = Math.floor(total / SECONDS_PER_MINUTE) % MINUTES_PER_HOUR;
  const s = total % SECONDS_PER_MINUTE;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

/** Whole local calendar days from `from` to `to` (negative when `to` is earlier). */
export function dayDifference(from: Date, to: Date): number {
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end - start) / MS_PER_DAY);
}

/** "today", "tomorrow", "yesterday" for a day offset of -1, 0 or 1 (a time zone is never further away). */
export function dayOffsetLabel(offset: number, locale?: string): string {
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(offset, "day");
}

const RELATIVE_DAY_LIMIT = 6;

/** "today", "tomorrow", "yesterday", then a short weekday, then a short date. Locale-aware. */
export function relativeDayLabel(target: Date, now: Date, locale?: string): string {
  const diff = dayDifference(now, target);
  if (Math.abs(diff) <= 1) return dayOffsetLabel(diff, locale);
  if (diff > 1 && diff <= RELATIVE_DAY_LIMIT) return target.toLocaleDateString(locale, { weekday: "short" });
  const sameYear = target.getFullYear() === now.getFullYear();
  return target.toLocaleDateString(locale, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}

export type TemperatureUnit = "c" | "f";

/** Fahrenheit is the default in the few regions that still use it. */
const FAHRENHEIT_REGIONS: ReadonlySet<string> = new Set(["US", "LR", "MM", "BS", "BZ", "KY", "PW"]);

export function defaultTemperatureUnit(languageTag: string): TemperatureUnit {
  try {
    const region = new Intl.Locale(languageTag).maximize().region;
    return region && FAHRENHEIT_REGIONS.has(region) ? "f" : "c";
  } catch {
    return "c";
  }
}

/** Converts the provider's Celsius value for display and rounds it. */
export function displayTemperature(celsius: number, unit: TemperatureUnit): number {
  return Math.round(unit === "f" ? (celsius * 9) / 5 + 32 : celsius);
}

/** "16:59" style local time of a timestamp, honouring the 12/24-hour choice. */
export function timeOfDay(timestamp: number, hour24: boolean, locale?: string): string {
  return new Date(timestamp).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", hour12: !hour24 });
}

const BYTES_PER_GIB = 1024 ** 3;
const MAX_FRACTION_DIGITS = 1;

function gigabyteNumber(bytes: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: MAX_FRACTION_DIGITS }).format(bytes / BYTES_PER_GIB);
}

/** "15.9 GB" in the user's number format. Memory and drives are reported in binary gigabytes. */
export function formatGigabytes(bytes: number, locale?: string): string {
  return `${gigabyteNumber(bytes, locale)} GB`;
}

/** "10.9 / 15.9 GB". */
export function formatGigabytePair(used: number, total: number, locale?: string): string {
  return `${gigabyteNumber(used, locale)} / ${formatGigabytes(total, locale)}`;
}

/** Share of a whole as a rounded whole percent; 0 when the whole is unknown. */
export function wholePercent(part: number, whole: number): number {
  return whole > 0 ? Math.min(100, Math.max(0, Math.round((part / whole) * 100))) : 0;
}
