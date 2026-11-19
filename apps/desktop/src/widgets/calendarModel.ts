import { MS_PER_DAY } from "./format";

/** Month grid maths for the calendar widget. Pure: the component only renders what this returns. */
export const DAYS_PER_WEEK = 7;
const MONTHS_PER_YEAR = 12;

/** 0 = Sunday … 6 = Saturday, the same numbering as Date.getDay(). */
export type WeekStart = 0 | 1 | 6;

export type WeekStartSetting = "auto" | "mon" | "sun" | "sat";

const SETTING_TO_DAY: Record<Exclude<WeekStartSetting, "auto">, WeekStart> = { mon: 1, sun: 0, sat: 6 };
const FALLBACK_WEEK_START: WeekStart = 1;

interface LocaleWithWeekInfo extends Intl.Locale {
  getWeekInfo?: () => { firstDay: number };
  weekInfo?: { firstDay: number };
}

/** First day of the week for a locale. Intl numbers days 1 = Monday … 7 = Sunday. */
export function localeWeekStart(languageTag: string): WeekStart {
  try {
    const locale = new Intl.Locale(languageTag) as LocaleWithWeekInfo;
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    if (info) {
      const day = info.firstDay % DAYS_PER_WEEK;
      if (day === 0 || day === 1 || day === 6) return day;
    }
  } catch {
    // Unknown language tag: use the fallback below.
  }
  return FALLBACK_WEEK_START;
}

export function resolveWeekStart(setting: WeekStartSetting, languageTag: string): WeekStart {
  return setting === "auto" ? localeWeekStart(languageTag) : SETTING_TO_DAY[setting];
}

export interface MonthModel {
  readonly year: number;
  /** 0 to 11. */
  readonly month: number;
  readonly daysInMonth: number;
  /** One entry per grid cell: the day number, or null for padding. Always whole weeks. */
  readonly cells: readonly (number | null)[];
  readonly weekCount: number;
  /** ISO week number of the week containing each row's first real day. */
  readonly weekNumbers: readonly number[];
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** ISO 8601 week number (weeks start on Monday, week 1 holds the year's first Thursday). */
export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = d.getUTCDay() || DAYS_PER_WEEK;
  d.setUTCDate(d.getUTCDate() + 4 - dayNumber);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / MS_PER_DAY + 1) / DAYS_PER_WEEK);
}

/** Pads to whole weeks, and to `minWeeks` rows when a fixed-height grid needs them. */
export function buildMonth(year: number, month: number, weekStart: WeekStart, minWeeks = 0): MonthModel {
  const total = daysInMonth(year, month);
  const lead = (new Date(year, month, 1).getDay() - weekStart + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  const weekCount = Math.max(minWeeks, Math.ceil((lead + total) / DAYS_PER_WEEK));
  const cells: (number | null)[] = Array.from({ length: weekCount * DAYS_PER_WEEK }, (_, i) => {
    const day = i - lead + 1;
    return day >= 1 && day <= total ? day : null;
  });
  const weekNumbers = Array.from({ length: weekCount }, (_, w) => {
    const firstDay = cells.slice(w * DAYS_PER_WEEK, (w + 1) * DAYS_PER_WEEK).find((d): d is number => d !== null);
    return isoWeek(new Date(year, month, firstDay ?? 1));
  });
  return { year, month, daysInMonth: total, cells, weekCount, weekNumbers };
}

/** Moves a (year, month) pair by whole months, rolling the year. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * MONTHS_PER_YEAR + month + delta;
  return { year: Math.floor(index / MONTHS_PER_YEAR), month: ((index % MONTHS_PER_YEAR) + MONTHS_PER_YEAR) % MONTHS_PER_YEAR };
}

/** Weekday columns in display order, starting from `weekStart`. */
export function weekdayOrder(weekStart: WeekStart): readonly number[] {
  return Array.from({ length: DAYS_PER_WEEK }, (_, i) => (weekStart + i) % DAYS_PER_WEEK);
}

/** Single-letter weekday labels in the user's locale, ordered from `weekStart`. */
export function weekdayLabels(weekStart: WeekStart, locale?: string): readonly string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
  // 2024-01-07 was a Sunday, so day numbers map straight onto it.
  return weekdayOrder(weekStart).map((day) => format.format(new Date(2024, 0, 7 + day)));
}
