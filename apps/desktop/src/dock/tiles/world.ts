import { CITIES, cityById, type City } from "../../widgets/data/cities";
import { formatUtcOffset, fieldsDayDifference, localFields, utcOffsetMinutes, zonedFields } from "../../widgets/zones";
import { fold } from "../nav";

/** The most cities the world clock keeps: the tile shows two, the popover the rest. */
export const MAX_CITIES = 6;

export const WORLD_KEY = "dotdock.dock.worldCities";

export interface WorldRow {
  readonly city: City;
  /** "14:30" or "2:30 PM", in the user's format. */
  readonly time: string;
  /** Whole days ahead (positive) or behind (negative) of this device's date. */
  readonly dayOffset: number;
  /** "UTC+9". */
  readonly offset: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function timeIn(date: Date, timeZone: string): string {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone });
    formatters.set(timeZone, format);
  }
  return format.format(date);
}

/** The chosen cities as rows: what time it is there, and whether it is already tomorrow or still yesterday. */
export function worldRows(ids: readonly string[], now: Date): WorldRow[] {
  const here = localFields(now);
  return ids.flatMap((id) => {
    const city = cityById(id);
    if (!city) return [];
    return [
      {
        city,
        time: timeIn(now, city.timeZone),
        dayOffset: fieldsDayDifference(here, zonedFields(now, city.timeZone)),
        offset: formatUtcOffset(utcOffsetMinutes(now, city.timeZone)),
      },
    ];
  });
}

/** Cities that are not chosen yet and match what was typed, by name, best first; all of them for an empty query. */
export function cityChoices(chosen: readonly string[], query: string): City[] {
  const q = fold(query.trim());
  const open = CITIES.filter((c) => !chosen.includes(c.id));
  if (q === "") return open;
  return open
    .filter((c) => fold(c.name).includes(q) || fold(c.timeZone).includes(q))
    .sort((a, b) => Number(fold(b.name).startsWith(q)) - Number(fold(a.name).startsWith(q)));
}

export function addCity(ids: readonly string[], id: string): string[] {
  if (ids.includes(id) || !cityById(id) || ids.length >= MAX_CITIES) return [...ids];
  return [...ids, id];
}

export const removeCity = (ids: readonly string[], id: string): string[] => ids.filter((c) => c !== id);

export function parseCities(raw: string | null): string[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v, i, all): v is string => typeof v === "string" && cityById(v) !== undefined && all.indexOf(v) === i).slice(0, MAX_CITIES);
  } catch {
    return [];
  }
}
