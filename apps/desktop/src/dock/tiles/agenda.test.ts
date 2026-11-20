import { describe, expect, it } from "vitest";
import { isLive, nextAgendaChange, summariseAgenda } from "./agenda";
import type { AgendaEvent } from "./ui-types";

const MIN = 60_000;
const NOW = 10_000 * MIN;
const event = (id: string, startsIn: number, lastsMin: number, extra: Partial<AgendaEvent> = {}): AgendaEvent => ({
  id,
  title: id,
  startsAt: NOW + startsIn * MIN,
  endsAt: NOW + (startsIn + lastsMin) * MIN,
  allDay: false,
  location: null,
  ...extra,
});

describe("summariseAgenda", () => {
  const events = [event("later", 120, 30), event("over", -180, 30), event("now", -10, 60), event("soon", 30, 15), event("holiday", -600, 1440, { allDay: true })];

  it("sorts a day into over, still to come and all day", () => {
    const summary = summariseAgenda(events, NOW, 2);
    expect(summary.past.map((e) => e.id)).toEqual(["over"]);
    expect(summary.upcoming.map((e) => e.id)).toEqual(["now", "soon", "later"]);
    expect(summary.allDay.map((e) => e.id)).toEqual(["holiday"]);
  });

  it("leads with what is on now, then what is next", () => {
    expect(summariseAgenda(events, NOW, 1).shown.map((e) => e.id)).toEqual(["now"]);
  });

  it("says how many more there are than the tile has room for", () => {
    const summary = summariseAgenda(events, NOW, 2);
    expect(summary.shown).toHaveLength(2);
    expect(summary.more).toBe(1);
    expect(summariseAgenda(events, NOW, 10).more).toBe(0);
  });

  it("counts an event as over the moment it ends", () => {
    expect(summariseAgenda([event("edge", -30, 30)], NOW, 1).past).toHaveLength(1);
  });

  it("copes with an empty day", () => {
    expect(summariseAgenda([], NOW, 1)).toEqual({ upcoming: [], past: [], allDay: [], shown: [], more: 0 });
  });

  it("breaks ties by end time, then title, so the order never shuffles", () => {
    const tie = [event("b", 10, 30), event("a", 10, 30), event("short", 10, 5)];
    expect(summariseAgenda(tie, NOW, 3).upcoming.map((e) => e.id)).toEqual(["short", "a", "b"]);
  });
});

describe("isLive", () => {
  it("is true from the start up to, not including, the end", () => {
    const e = event("x", 0, 30);
    expect(isLive(e, NOW)).toBe(true);
    expect(isLive(e, NOW + 30 * MIN - 1)).toBe(true);
    expect(isLive(e, NOW + 30 * MIN)).toBe(false);
    expect(isLive(e, NOW - 1)).toBe(false);
  });
});

describe("nextAgendaChange", () => {
  it("is the next start or end after now", () => {
    expect(nextAgendaChange([event("now", -10, 60), event("soon", 30, 15)], NOW)).toBe(NOW + 30 * MIN);
  });

  it("skips what already ended", () => {
    expect(nextAgendaChange([event("done", -10, 5), event("soon", 30, 15)], NOW)).toBe(NOW + 30 * MIN);
  });

  it("wakes at the end of the event on now when nothing starts before it", () => {
    expect(nextAgendaChange([event("now", -10, 40)], NOW)).toBe(NOW + 30 * MIN);
  });

  it("ignores all-day events and returns null when nothing is left", () => {
    expect(nextAgendaChange([event("day", -60, 1440, { allDay: true }), event("over", -120, 30)], NOW)).toBeNull();
    expect(nextAgendaChange([], NOW)).toBeNull();
  });
});
