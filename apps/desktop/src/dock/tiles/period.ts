/** How far through the day, the month and the year it is, laid out as grids of dots. */

const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const PERCENT = 100;
/** The day is two rows of twelve: the morning above, the afternoon below. */
const DAY_COLUMNS = 12;

export type PeriodId = "day" | "month" | "year";

export interface PeriodGrid {
  readonly id: PeriodId;
  /** Cells in the grid: hours in a day, days in a month, days in a year. */
  readonly total: number;
  /** Cells that are over. The one after them is the current one. */
  readonly done: number;
  /** How far through the current cell, 0 to 1. */
  readonly partial: number;
  readonly cols: number;
  readonly rows: number;
  /** "row" fills a row before the next (the day); "column" fills a week at a time, top to bottom. */
  readonly order: "row" | "column";
  /** Whole percent of the period that has passed. */
  readonly percent: number;
}

export interface Cell {
  readonly col: number;
  readonly row: number;
  readonly state: "past" | "current" | "ahead";
}

const startOfDay = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const daysInMonth = (year: number, month: number): number => new Date(year, month + 1, 0).getDate();
const daysInYear = (year: number): number => (new Date(year + 1, 0, 1).getTime() - new Date(year, 0, 1).getTime()) / MS_PER_DAY;

/** Whole calendar days from the first of January to `date`, ignoring daylight-saving hours. */
function dayOfYear(date: Date): number {
  const days = (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 1)) / MS_PER_DAY;
  return Math.round(days);
}

/** Fraction of the local day that has passed. */
function dayFraction(date: Date): number {
  const start = startOfDay(date).getTime();
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
  return (date.getTime() - start) / (end - start);
}

function grid(id: PeriodId, total: number, elapsed: number, order: PeriodGrid["order"], cols: number): PeriodGrid {
  const done = Math.min(total, Math.floor(elapsed));
  return {
    id,
    total,
    done,
    partial: Math.min(1, elapsed - done),
    cols,
    rows: order === "row" ? Math.ceil(total / cols) : DAYS_PER_WEEK,
    order,
    percent: Math.floor(Math.min(1, elapsed / total) * PERCENT),
  };
}

export function periodGrids(now: Date): Record<PeriodId, PeriodGrid> {
  const fraction = dayFraction(now);
  const monthDays = daysInMonth(now.getFullYear(), now.getMonth());
  const yearDays = daysInYear(now.getFullYear());
  return {
    day: grid("day", HOURS_PER_DAY, fraction * HOURS_PER_DAY, "row", DAY_COLUMNS),
    month: grid("month", monthDays, now.getDate() - 1 + fraction, "column", Math.ceil(monthDays / DAYS_PER_WEEK)),
    year: grid("year", yearDays, dayOfYear(now) + fraction, "column", Math.ceil(yearDays / DAYS_PER_WEEK)),
  };
}

/** Every cell of a grid with its position and whether it is over, now, or still to come. */
export function gridCells(g: PeriodGrid): readonly Cell[] {
  return Array.from({ length: g.total }, (_, i): Cell => {
    const col = g.order === "row" ? i % g.cols : Math.floor(i / DAYS_PER_WEEK);
    const row = g.order === "row" ? Math.floor(i / g.cols) : i % DAYS_PER_WEEK;
    return { col, row, state: i < g.done ? "past" : i === g.done ? "current" : "ahead" };
  });
}


/** The first moment of the next local day after `now` (epoch ms): when "today" changes. */
export function nextMidnight(now: number): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
}
