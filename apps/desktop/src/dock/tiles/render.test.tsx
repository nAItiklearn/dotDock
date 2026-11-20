import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { INITIAL_TIMER, type TimerState } from "../../widgets/timerModel";
import type { TileId } from "../model";
import { TILE_IDS } from "../model";
import type { AgendaView, AudioView, ContactsView, HydrationView, MeetingView, StopwatchView, TileFeed, TileFeeds, TileIssue } from "./ui-types";

/**
 * Every live tile, drawn on the dock and opened as a popover, in each state its feed can be in. Rendered on the
 * server renderer: the markup is what the dock paints, and no effect runs, so each case is one frame of one state.
 * What happens on a click is held by `devTiles.test.ts`, and by the live run in `docs/QA/dock-live/`.
 */

vi.stubGlobal("window", { innerWidth: 1920, innerHeight: 1080, addEventListener: () => undefined, removeEventListener: () => undefined, matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }) });
vi.stubGlobal("document", { hidden: false, addEventListener: () => undefined, removeEventListener: () => undefined });
vi.stubGlobal("location", { search: "" });
vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
vi.stubGlobal("navigator", { onLine: true });

const { Tile } = await import("./Tile");
const { TilePopover } = await import("./popovers");
const { Gallery } = await import("../Gallery");
const { Prefs, drawnAsHint } = await import("../Prefs");
const { Slot } = await import("../items");
const { useFeedStore } = await import("./feeds");
const { useDockStore } = await import("../store");
const { useTimerStore } = await import("../../widgets/timerStore");
const { useTodoStore } = await import("../../widgets/todoStore");
const { useProviderStore } = await import("../../providers/store");

const MIN = 60_000;
const HOUR = 60 * MIN;
const noop = (): void => undefined;
const controls = { editing: false, open: false, onPress: noop, onActivate: noop, onPressKey: noop };

const face = (id: TileId, open = false): string => renderToStaticMarkup(<Tile id={id} controls={{ ...controls, open }} />);
const popover = (id: Parameters<typeof TilePopover>[0]["open"]["id"]): string => renderToStaticMarkup(<TilePopover open={{ id, from: { x: 800, y: 980, w: 60, h: 60 } }} />);

const ready = <T,>(data: T): TileFeed<T> => ({ data, issue: null });
const failed = (issue: TileIssue): TileFeed<never> => ({ data: null, issue });
/**
 * The server renderer reads a store's initial state, not its current one, so a case's state is written into both.
 * Only these tests do this; the dock reads the live state.
 */
function seed<S extends object>(store: { getInitialState: () => S; setState: (patch: Partial<S>) => void }, patch: Partial<S>): void {
  Object.assign(store.getInitialState(), patch);
  store.setState(patch);
}

/** The markup of the first button whose visible text or label is `name`. */
function button(html: string, name: string): string | undefined {
  const buttons = html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*<\/button>/g) ?? [];
  return buttons.find((b) => b.replace(/<[^>]*>/g, "").trim() === name || b.includes(`aria-label="${name}"`));
}

const feeds = (next: Partial<TileFeeds>): void => seed(useFeedStore, { feeds: next });
const setTimer = (timer: TimerState): void => seed(useTimerStore, { timer });
const setItems = (items: readonly { id: string; text: string; done: boolean; due: string | null }[]): void => seed(useTodoStore, { items });

const now = Date.now();
const agenda: AgendaView = {
  day: new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 15).getTime(),
  events: [
    { id: "a", title: "Standup", startsAt: now - 3 * HOUR, endsAt: now - 2 * HOUR, allDay: false, location: "Room 4" },
    { id: "b", title: "Design review", startsAt: now - 10 * MIN, endsAt: now + 50 * MIN, allDay: false, location: null },
    { id: "c", title: "Lunch with Priya", startsAt: now + 2 * HOUR, endsAt: now + 3 * HOUR, allDay: false, location: null },
    { id: "d", title: "Offsite", startsAt: now - 5 * HOUR, endsAt: now + 5 * HOUR, allDay: true, location: null },
  ],
};
const meeting = (startsIn: number, joinUrl: string | null = "https://meet.example/x"): MeetingView => ({
  id: "m",
  title: "Weekly sync",
  startsAt: now + startsIn,
  endsAt: now + startsIn + 45 * MIN,
  service: joinUrl === null ? null : "Teams",
  joinUrl,
  location: joinUrl === null ? "Room 2.14" : null,
});
const contacts: ContactsView = {
  contacts: [
    { id: "1", name: "Maya Okafor", channels: [{ action: "message", app: "WhatsApp" }, { action: "call", app: "Phone Link" }] },
    { id: "2", name: "Jonas Weber", channels: [{ action: "video", app: "Zoom" }] },
  ],
};
const stopwatch = (patch: Partial<StopwatchView> = {}): StopwatchView => ({ running: false, startedAt: null, bankedMs: 0, laps: [], ...patch });
const hydration = (patch: Partial<HydrationView> = {}): HydrationView => ({ goalMl: 2000, loggedMl: 750, glassMl: 250, nextReminderAt: now + 20 * MIN, intervalMinutes: 60, ...patch });
const audio = (patch: Partial<AudioView> = {}): AudioView => ({
  devices: [
    { id: "s", name: "Speakers", kind: "speakers", current: true },
    { id: "h", name: "Headphones", kind: "headphones", current: false },
  ],
  volume: 0.46,
  muted: false,
  ...patch,
});

beforeEach(() => {
  feeds({});
  setTimer(INITIAL_TIMER);
  setItems([]);
  seed(useDockStore, { frozen: false });
});

describe("every tile on the dock", () => {
  it.each(["agenda", "meeting", "stopwatch", "hydration", "contacts", "mic", "audio"] as const)("draws %s before its feed has arrived", (id) => {
    const html = face(id);
    expect(html).toContain(`tile--${id}`);
    expect(html).toContain('data-state="pending"');
  });

  it.each([
    ["agenda", "Not available"],
    ["meeting", "Not available"],
    ["stopwatch", "Not available"],
    ["contacts", "Not available"],
  ] as const)("says why %s has nothing to show", (id, words) => {
    feeds({ [id]: failed("unsupported") });
    const html = face(id);
    expect(html).toContain(words);
    expect(html).toContain('data-state="issue"');
  });

  it.each(["unsupported", "no-device", "offline", "error", "needs-setup"] as const)("gives the microphone a designed %s state", (issue) => {
    feeds({ mic: failed(issue) });
    const html = face("mic");
    expect(html).toContain("disabled");
    expect(html).toContain('data-state="issue"');
  });

  it("opens a popover from every tile that has one, and marks it open", () => {
    for (const id of ["agenda", "meeting", "focus", "stopwatch", "hydration", "reminders", "progress", "contacts", "audio", "system"] as const) {
      const html = face(id, true);
      expect(html).toContain('aria-haspopup="dialog"');
      expect(html).toContain('aria-expanded="true"');
    }
  });

  it("leaves the clock, the player and the microphone without a popover button", () => {
    for (const id of ["clock", "media"] as const) expect(face(id)).not.toContain("tile__hit");
    expect(face("mic")).not.toContain("aria-haspopup");
  });
});

describe("agenda", () => {
  it("leads with what is on now and counts what follows", () => {
    feeds({ agenda: ready(agenda) });
    const html = face("agenda");
    expect(html).toContain("Design review");
    expect(html).toContain("Now");
    expect(html).toContain("+1 more");
    expect(html).toContain(">15<");
  });

  it("shows an all-day event when nothing else is left", () => {
    feeds({ agenda: ready({ ...agenda, events: agenda.events.filter((e) => e.allDay) }) });
    const html = face("agenda");
    expect(html).toContain("Offsite");
    expect(html).toContain("All day");
  });

  it("has a state for a day with nothing on", () => {
    feeds({ agenda: ready({ ...agenda, events: [] }) });
    expect(face("agenda")).toContain("Nothing on today");
    expect(popover("agenda")).toContain("Nothing on today");
  });

  it("lists the day in the popover under earlier, now and still to come", () => {
    feeds({ agenda: ready(agenda) });
    const html = popover("agenda");
    for (const words of ["Standup", "Earlier today", "Still to come", "Design review", "Lunch with Priya", "Offsite", "All day"]) expect(html).toContain(words);
  });

  it("explains an issue in the popover", () => {
    feeds({ agenda: failed("needs-setup") });
    const html = popover("agenda");
    expect(html).toContain("Needs setting up");
    expect(html).toContain("Choose what to show in the dock settings.");
  });
});

describe("meeting", () => {
  it("counts down and offers Join with the service's name when there is a link", () => {
    feeds({ meeting: ready(meeting(12 * MIN)) });
    const html = face("meeting");
    expect(html).toContain("Weekly sync");
    expect(html).toMatch(/in 1[12] min/);
    expect(html).toContain('aria-label="Join with Teams"');
  });

  it("has no Join button when the event has no link, or is over", () => {
    feeds({ meeting: ready(meeting(12 * MIN, null)) });
    expect(face("meeting")).not.toContain("Join");
    feeds({ meeting: ready({ ...meeting(-2 * HOUR), endsAt: now - HOUR }) });
    expect(face("meeting")).not.toContain("Join");
    expect(face("meeting")).toContain("Ended");
  });

  it("goes urgent inside five minutes", () => {
    feeds({ meeting: ready(meeting(4 * MIN)) });
    expect(face("meeting")).toContain('data-tone="urgent"');
    feeds({ meeting: ready(meeting(30 * MIN)) });
    expect(face("meeting")).not.toContain('data-tone="urgent"');
  });

  it("says there is none, in the tile and the popover", () => {
    feeds({ meeting: ready(null) });
    expect(face("meeting")).toContain("No meetings today");
    expect(popover("meeting")).toContain("No meetings today");
    expect(popover("meeting")).toContain("The next event on your calendar shows here.");
  });

  it("shows when, where and a Join button in the popover", () => {
    feeds({ meeting: ready(meeting(12 * MIN)) });
    const html = popover("meeting");
    expect(html).toContain("Weekly sync");
    expect(html).toContain("Join with Teams");
    feeds({ meeting: ready(meeting(12 * MIN, null)) });
    const without = popover("meeting");
    expect(without).toContain("Room 2.14");
    expect(without).not.toContain("Join");
  });
});

describe("focus", () => {
  const pomodoro = (patch: Partial<TimerState>): TimerState => ({ ...INITIAL_TIMER, mode: "pomodoro", ...patch });

  it("starts at 25:00, session 1 of 4", () => {
    setTimer(pomodoro({}));
    const html = face("focus");
    expect(html).toContain("25:00");
    expect(html).toContain("Focus · 1/4");
    expect(html).toContain('aria-label="Start"');
  });

  it("offers Pause while running and Resume while paused", () => {
    setTimer(pomodoro({ status: "running", startedAt: Date.now() - 5 * MIN }));
    expect(face("focus")).toContain('aria-label="Pause"');
    setTimer(pomodoro({ status: "paused", bankedMs: 5 * MIN }));
    expect(face("focus")).toContain('aria-label="Resume"');
    expect(face("focus")).toContain("20:00");
  });

  it("names the break after a session, and the long one after the last", () => {
    setTimer(pomodoro({ phase: "short", focusDone: 1 }));
    expect(face("focus")).toContain("Short break · 1/4");
    setTimer(pomodoro({ phase: "long", focusDone: 4 }));
    expect(face("focus")).toContain("Long break");
  });

  it("will not start over a timer that is running on the home screen, and says so", () => {
    setTimer({ ...INITIAL_TIMER, mode: "countdown", status: "running", startedAt: Date.now() - MIN });
    expect(button(face("focus"), "Start")).toContain('disabled=""');
    expect(popover("focus")).toContain("A timer is already running on your home screen.");
  });

  it("shows the controls and the session dots in the popover", () => {
    setTimer(pomodoro({ focusDone: 2 }));
    const html = popover("focus");
    for (const words of ["Start", "Skip", "Reset", "Session 3 of 4", "Then a 5 min break"]) expect(html).toContain(words);
  });
});

describe("stopwatch", () => {
  it("shows its time and its lap count", () => {
    feeds({ stopwatch: ready(stopwatch({ bankedMs: 247_000, laps: [100_000, 200_000] })) });
    const html = face("stopwatch");
    expect(html).toContain("04:07");
    expect(html).toContain("Lap 2");
  });

  it("offers Start when stopped and Pause when running", () => {
    feeds({ stopwatch: ready(stopwatch()) });
    expect(face("stopwatch")).toContain('aria-label="Start"');
    feeds({ stopwatch: ready(stopwatch({ running: true, startedAt: Date.now() - 1000 })) });
    expect(face("stopwatch")).toContain('aria-label="Pause"');
  });

  it("lists laps newest first with the fastest and slowest marked, in the popover", () => {
    feeds({ stopwatch: ready(stopwatch({ bankedMs: 60_000, laps: [10_000, 25_000, 33_000, 53_000] })) });
    const html = popover("stopwatch");
    expect(html.indexOf("Lap 4")).toBeLessThan(html.indexOf("Lap 1"));
    expect(html).toContain("Fastest");
    expect(html).toContain("Slowest");
  });

  it("invites the first lap, and keeps Lap off until it runs", () => {
    feeds({ stopwatch: ready(stopwatch()) });
    const html = popover("stopwatch");
    expect(html).toContain("Laps appear here");
    expect(button(html, "Lap")).toContain('disabled=""');
    expect(button(html, "Start")).not.toContain('disabled=""');
  });
});

describe("hydration", () => {
  it("says how much has been drunk of the goal", () => {
    feeds({ hydration: ready(hydration()) });
    expect(face("hydration")).toContain("750 mL of 2 L");
  });

  it("offers a glass, a snooze and the next reminder in the popover", () => {
    feeds({ hydration: ready(hydration()) });
    const html = popover("hydration");
    for (const words of ["Drink a glass, 250 mL", "Snooze 30 min", "Next reminder at"]) expect(html).toContain(words);
  });

  it("says when the goal is reached, and when reminders are off", () => {
    feeds({ hydration: ready(hydration({ loggedMl: 2000 })) });
    expect(popover("hydration")).toContain("Goal reached");
    feeds({ hydration: ready(hydration({ nextReminderAt: null })) });
    const html = popover("hydration");
    expect(html).toContain("Reminders are off");
    expect(button(html, "Snooze 30 min")).toContain('disabled=""');
  });
});

describe("reminders", () => {
  const item = (id: string, text: string, due: string | null = null, done = false) => ({ id, text, done, due });
  const today = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  it("has a state for nothing to do", () => {
    expect(face("reminders")).toContain("Nothing to do");
    expect(popover("reminders")).toContain("Reminders you add show up here and on the home screen.");
  });

  it("leads with what needs doing and counts what is overdue", () => {
    setItems([item("1", "Plain"), item("2", "Pay the invoice", "2000-01-01"), item("3", "Done", null, true)]);
    const html = face("reminders");
    expect(html).toContain("Pay the invoice");
    expect(html).toContain("1 overdue");
    expect(html).toContain(">2<");
  });

  it("counts what is due today", () => {
    setItems([item("1", "Call the bank", today())]);
    expect(face("reminders")).toContain("1 today");
  });

  it("lists every reminder with a way to tick and delete it, and a field to add one", () => {
    setItems([item("1", "Plain"), item("2", "Finished", null, true)]);
    const html = popover("reminders");
    expect(html).toContain('aria-label="Mark Plain as done"');
    expect(html).toContain('aria-label="Mark Finished as not done"');
    expect(html).toContain('aria-label="Delete Plain"');
    expect(html).toContain('placeholder="Remind me to…"');
    expect(html).toContain("1 open");
  });
});

describe("progress", () => {
  it("shows how far through the day it is, and all three periods in the popover", () => {
    expect(face("progress")).toMatch(/\d+%/);
    const html = popover("progress");
    for (const words of ["Day", "Month", "Year"]) expect(html).toContain(words);
    expect(html.match(/<circle/g)?.length).toBeGreaterThan(24 + 28 + 365);
  });
});

describe("contacts", () => {
  it("shows their initials", () => {
    feeds({ contacts: ready(contacts) });
    const html = face("contacts");
    expect(html).toContain("MO");
    expect(html).toContain("JW");
  });

  it("counts the people beyond the first three", () => {
    feeds({ contacts: ready({ contacts: Array.from({ length: 5 }, (_, i) => ({ id: String(i), name: `Person ${i}`, channels: [] })) }) });
    expect(face("contacts")).toContain("+2");
  });

  it("has a state for nobody chosen yet", () => {
    feeds({ contacts: ready({ contacts: [] }) });
    expect(face("contacts")).toContain("No contacts yet");
    expect(popover("contacts")).toContain("Choose people in the dock settings to reach them from here.");
  });

  it("gives each way of reaching someone its own labelled button, call before message", () => {
    feeds({ contacts: ready(contacts) });
    const html = popover("contacts");
    expect(html).toContain('aria-label="Call Maya Okafor with Phone Link"');
    expect(html).toContain('aria-label="Message Maya Okafor with WhatsApp"');
    expect(html).toContain('aria-label="Video Jonas Weber with Zoom"');
    expect(html.indexOf("Call Maya")).toBeLessThan(html.indexOf("Message Maya"));
    expect(html).not.toContain("Video Maya");
  });
});

describe("microphone", () => {
  it("shows it live, and offers to mute", () => {
    feeds({ mic: ready({ muted: false }) });
    const html = face("mic");
    expect(html).toContain('aria-label="Mute microphone"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Listening");
  });

  it("shows it muted, and offers to unmute", () => {
    feeds({ mic: ready({ muted: true }) });
    const html = face("mic");
    expect(html).toContain('aria-label="Unmute microphone"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Muted");
  });
});

describe("sound", () => {
  it("shows the volume, and silence when muted or at zero", () => {
    feeds({ audio: ready(audio()) });
    expect(face("audio")).toContain("46%");
    feeds({ audio: ready(audio({ muted: true })) });
    expect(face("audio")).toContain("Mute");
    expect(face("audio")).toContain("M4 9.5h3.5");
  });

  it("lists the outputs with the current one checked, and has a volume slider", () => {
    feeds({ audio: ready(audio()) });
    const html = popover("audio");
    expect(html).toMatch(/aria-checked="true"[^>]*><i[^>]*><\/i>Speakers/);
    expect(html).toMatch(/aria-checked="false"[^>]*><i[^>]*><\/i>Headphones/);
    expect(html).toContain('type="range"');
    expect(html).toContain('aria-label="Mute"');
  });

  it("says when there are no devices, and offers to unmute when muted", () => {
    feeds({ audio: ready(audio({ devices: [], muted: true })) });
    const html = popover("audio");
    expect(html).toContain("No sound devices");
    expect(html).toContain('aria-label="Unmute"');
  });

  it("has a state for no device found", () => {
    feeds({ audio: failed("no-device") });
    expect(popover("audio")).toContain("Connect one and it appears here.");
  });
});

describe("system", () => {
  const publish = (cpu: number): void => {
    const data = { memTotalBytes: 16e9, memUsedBytes: 8e9, cpuPercent: cpu, disks: [] };
    seed(useProviderStore, { states: { ...useProviderStore.getInitialState().states, system: { data, stale: false, issue: null } } });
  };

  it("shows memory in use on the tile and both loads in the popover", () => {
    publish(18);
    expect(face("system")).toContain("50");
    const html = popover("system");
    for (const words of ["Processor", "Memory", "Last 60 seconds", "18%", "50%"]) expect(html).toContain(words);
  });

  it("says so when the machine reports nothing", () => {
    seed(useProviderStore, { states: { ...useProviderStore.getInitialState().states, system: { data: null, stale: false, issue: "unsupported" } } });
    expect(popover("system")).toContain("Not available");
  });
});

describe("the popover itself", () => {
  it("is a labelled dialog with a close button, set beside the tile", () => {
    feeds({ mic: ready({ muted: false }), audio: ready(audio()) });
    const html = popover("audio");
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Sound"');
    expect(html).toContain('aria-label="Close"');
    expect(html).toMatch(/transform:translate3d\(/);
  });
});

describe("the widget gallery", () => {
  const from = { x: 700, y: 980, w: 520, h: 70 };
  const category = (id: string, order: number) => ({ id: id as never, name: null, tone: "blue" as const, order });
  const app = (id: string, cat: string) => ({ id, name: id, category: cat as never, filedBy: "known" as const, icon: "", publisher: null, firstSeen: 0 });
  const gallery = (tiles: readonly string[] = ["clock"]): string => {
    seed(useDockStore, {
      settings: { ...useDockStore.getInitialState().settings, tiles, pinned: [{ kind: "stack", category: "media" }] },
      categories: [category("media", 0), category("games", 1)],
      apps: [app("a", "media"), app("b", "games")],
    });
    return renderToStaticMarkup(<Gallery open={{ from }} />);
  };

  it("is a labelled dialog with a search field and a close button", () => {
    const html = gallery();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Add a widget"');
    expect(html).toContain('type="search"');
    expect(html).toContain('placeholder="Search widgets"');
    expect(html).toContain('aria-label="Close"');
  });

  it("has a card with a live preview and an Add button for every tile that is not on the dock", () => {
    const html = gallery(["clock"]);
    for (const id of TILE_IDS.filter((tile) => tile !== "clock")) {
      expect(html).toContain(`tile--${id}`);
    }
    expect(html).toContain('aria-label="Add Next meeting"');
    expect(html).toContain('aria-label="Add Stopwatch"');
    expect(html.match(/gcard__tile/g)?.length).toBe(TILE_IDS.length);
  });

  it("makes a preview something to look at, not to press", () => {
    expect(gallery()).toMatch(/class="gcard__tile"[^>]*inert/);
  });

  it("offers Remove, and says it is on the dock, for a tile that is", () => {
    const html = gallery(["clock", "focus"]);
    expect(html).toContain('aria-label="Remove Focus"');
    expect(html).toContain("On the dock");
    expect(html).toContain('aria-label="Remove Clock"');
  });

  it("lets tiles be dragged onto the dock, but not ones already there", () => {
    const html = gallery(["clock"]);
    expect(button(html, "Add Focus")).toBeDefined();
    expect(html).toMatch(/<li class="gcard" data-kind="tile" draggable="true"/);
    expect(html).toMatch(/<li class="gcard" data-kind="tile" data-on="true" draggable="false"/);
  });

  it("lists stacks, with their apps, beside the tiles", () => {
    const html = gallery();
    expect(html).toContain("Games");
    expect(html).toContain("1 app");
    expect(button(html, "Remove Media")).toBeDefined();
    expect(button(html, "Add Games")).toBeDefined();
  });

  it("keeps a closed slot for GitHub, Linear and Vercel, which cannot be added yet", () => {
    const html = gallery();
    for (const name of ["GitHub", "Linear", "Vercel"]) {
      const add = button(html, `Add ${name}`);
      expect(add).toContain('disabled=""');
      expect(add).toContain("aria-describedby");
    }
    expect(html).toContain("Needs an account. It stays off until you connect it in the dock settings.");
  });

  it("shows the groups with how many cards each holds", () => {
    const html = gallery();
    for (const words of ["All", "Time", "Focus and health", "Media and sound", "System", "People", "Developer", "Stacks"]) expect(html).toContain(words);
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/aria-selected="true"[^>]*>All/);
  });

  it("says what each tile is and how it sits on the dock", () => {
    const html = gallery();
    expect(html).toContain("A countdown to your next meeting, with Join when it has a link.");
    expect(html).toContain("Wide");
    expect(html).toContain("Round");
    expect(html).toContain("Opens a panel");
    expect(html).toContain("One tap switches it");
  });
});

describe("the dock settings popover", () => {
  const from = { x: 500, y: 980, w: 600, h: 70 };
  const prefs = (patch: Partial<ReturnType<typeof useDockStore.getInitialState>["settings"]> = {}, choice = "glass", drawn: Parameters<typeof Prefs>[0]["drawn"] = "glass"): string => {
    seed(useDockStore, { settings: { ...useDockStore.getInitialState().settings, iconSize: 48, magnification: 1.25, ...patch }, themeChoice: choice as never });
    return renderToStaticMarkup(<Prefs from={from} drawn={drawn} />);
  };

  it("is a small labelled dialog with position, size, magnification, two switches and the look", () => {
    const html = prefs();
    expect(html).toContain('aria-label="Dock settings"');
    for (const words of ["Position", "Icon size", "Magnification", "Hide when not in use", "Keep windows clear of the dock", "Look"]) expect(html).toContain(words);
  });

  it("marks the current position, size, magnification and look", () => {
    const html = prefs({ edge: "left", iconSize: 56, magnification: 1.4 }, "paper", "paper");
    expect(button(html, "Left")).toContain('aria-checked="true"');
    expect(button(html, "Bottom")).toContain('aria-checked="false"');
    expect(html).toContain("56 px");
    expect(html).toContain("1.40×");
    expect(button(html, "Paper")).toContain('aria-checked="true"');
    expect(button(html, "Glass")).toContain('aria-checked="false"');
  });

  it("says Off when magnification is off", () => {
    expect(prefs({ magnification: 1 })).toContain("Off");
  });

  it("shows the switches as they are set", () => {
    const html = prefs({ autoHide: true, reserveSpace: false });
    expect(html).toMatch(/role="switch" class="prefs__switch" aria-checked="true"><span>Hide when not in use/);
    expect(html).toMatch(/role="switch" class="prefs__switch" aria-checked="false"><span>Keep windows clear/);
  });

  it("offers every look the dock has", () => {
    const html = prefs();
    for (const words of ["Glass", "Glass lite", "Obsidian", "Paper", "Aurum", "Minimal"]) expect(button(html, words)).toBeDefined();
  });

  it("clamps a size or magnification outside the limits to what the dock really draws", () => {
    expect(prefs({ iconSize: 500 })).toContain("80 px");
    expect(prefs({ magnification: 9 })).toContain("1.60×");
  });

  it("says when glass is drawn as something else", () => {
    expect(drawnAsHint("glass", "glass")).toBeNull();
    expect(drawnAsHint("paper", "paper")).toBeNull();
    expect(drawnAsHint("glass", "glass-lite")).toBe("Drawn as Glass lite until the blur is available.");
    expect(prefs({}, "glass", "glass-lite")).toContain("Drawn as Glass lite until the blur is available.");
  });
});

describe("tiles in edit mode", () => {
  const slot = (id: TileId, size: "regular" | "compact", editing: boolean): string => {
    const handlers = { activate: noop, press: noop, pressKey: noop, context: noop, remove: noop, resize: noop, focused: noop, pointerDown: noop };
    return renderToStaticMarkup(
      <Slot entry={{ kind: "tile", key: `tile:${id}`, id, size }} icon={48} vertical={false} edge="bottom" editing={editing} roving={false} peak={1.25} open={false} handlers={handlers} />,
    );
  };

  it("has a remove badge on every tile and a size switch on the ones that have a shorter form", () => {
    for (const id of ["agenda", "focus", "contacts"] as const) {
      const html = slot(id, "regular", true);
      expect(html).toContain('class="remove"');
      expect(html).toContain('class="resize"');
    }
    for (const id of ["clock", "mic", "hydration", "system"] as const) {
      const html = slot(id, "regular", true);
      expect(html).toContain('class="remove"');
      expect(html).not.toContain('class="resize"');
    }
  });

  it("names the switch for what it will do", () => {
    expect(slot("focus", "regular", true)).toContain('aria-label="Make Focus compact"');
    expect(slot("focus", "compact", true)).toContain('aria-label="Make Focus wide"');
  });

  it("shows no edit controls outside edit mode", () => {
    const html = slot("focus", "regular", false);
    expect(html).not.toContain('class="remove"');
    expect(html).not.toContain('class="resize"');
  });

  it("marks a compact tile and gives it the length of one item", () => {
    expect(slot("agenda", "compact", false)).toContain('data-size="compact"');
    expect(slot("agenda", "compact", false)).toContain("--len:48px");
    expect(slot("agenda", "regular", false)).toContain("--len:172.8px");
  });
});
