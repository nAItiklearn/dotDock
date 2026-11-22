import type { AgendaEvent } from "./ui-types";

export interface AgendaSummary {
  /** Events still to come or under way, soonest first: what the tile leads with. */
  readonly upcoming: readonly AgendaEvent[];
  /** Events that have ended today. */
  readonly past: readonly AgendaEvent[];
  readonly allDay: readonly AgendaEvent[];
  /** The `limit` events the compact tile lists. */
  readonly shown: readonly AgendaEvent[];
  /** Upcoming events beyond `limit`: the tile's "+N more". */
  readonly more: number;
}

const byStart = (a: AgendaEvent, b: AgendaEvent): number => a.startsAt - b.startsAt || a.endsAt - b.endsAt || a.title.localeCompare(b.title);

/** Sorts a day's events into what is over, what is left and what lasts all day, and picks the ones the tile has room for. */
export function summariseAgenda(events: readonly AgendaEvent[], now: number, limit: number): AgendaSummary {
  const timed = events.filter((e) => !e.allDay).sort(byStart);
  const allDay = events.filter((e) => e.allDay).sort(byStart);
  const upcoming = timed.filter((e) => e.endsAt > now);
  const past = timed.filter((e) => e.endsAt <= now);
  return { upcoming, past, allDay, shown: upcoming.slice(0, limit), more: Math.max(0, upcoming.length - limit) };
}

/** Whether an event is under way at `now`. */
export const isLive = (event: AgendaEvent, now: number): boolean => event.startsAt <= now && now < event.endsAt;

/** The next moment an event starts or ends after `now`, which is when the tile's lead event changes; null when none is left. */
export function nextAgendaChange(events: readonly AgendaEvent[], now: number): number | null {
  const moments = events.filter((e) => !e.allDay).flatMap((e) => [e.startsAt, e.endsAt]).filter((at) => at > now);
  return moments.length === 0 ? null : Math.min(...moments);
}
