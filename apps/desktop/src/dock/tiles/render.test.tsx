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
const { Prefs, drawnAsHint, resetPatch } = await import("../Prefs");
const { Slot } = await import("../items");
const { useNotesStore } = await import("../../widgets/notesStore");
const { useTools } = await import("./toolsStore");
const { useNetworkHistory } = await import("./networkHistory");
const { conversionText } = await import("./toolsFaces");
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
    expect(html).toContain('aria-label="Customise the dock"');
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

  it("starts with the items: add an app, add a widget, arrange and remove", () => {
    const html = prefs();
    for (const words of ["Items", "Add an app", "Add a widget", "Arrange and remove"]) expect(button(html, words) ?? html).toContain(words);
    expect(html.indexOf("Items")).toBeLessThan(html.indexOf("Position"));
  });

  it("ends with the taskbar switch and a reset", () => {
    const html = prefs({ replaceTaskbar: true });
    expect(html).toMatch(/role="switch" class="prefs__switch" aria-checked="true"><span>Replace the Windows taskbar/);
    expect(button(html, "Reset the dock")).toBeDefined();
  });

  it("resets how the dock looks, but never whether it runs or replaces the taskbar", () => {
    const patch = resetPatch({ enabled: true, replaceTaskbar: true });
    expect(patch).toMatchObject({ pinned: [], tiles: [], edge: "bottom", iconSize: 48, magnification: 1.25, autoHide: false, reserveSpace: true, enabled: true, replaceTaskbar: true });
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
      <Slot entry={{ kind: "tile", key: `tile:${id}`, id, size }} icon={48} vertical={false} edge="bottom" editing={editing} roving={false} peak={1.25} open={false} handlers={handlers} dpr={1} />,
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
    expect(slot("agenda", "regular", false)).toContain("--len:173px");
  });
});

describe("processor, battery and the analog clock", () => {
  it("shows the load as a ring and a number", () => {
    seed(useProviderStore, { states: { ...useProviderStore.getInitialState().states, system: { data: { memTotalBytes: 16e9, memUsedBytes: 8e9, cpuPercent: 34, disks: [] }, stale: false, issue: null } } });
    const html = face("cpu");
    expect(html).toContain(">34<");
    expect(html).toContain('aria-label="Processor 34%"');
    expect(html.match(/<circle/g)).toHaveLength(12);
  });

  it("has a state for a machine that reports no processor load", () => {
    seed(useProviderStore, { states: { ...useProviderStore.getInitialState().states, system: { data: null, stale: false, issue: "unsupported" } } });
    expect(face("cpu")).toContain(">–<");
  });

  const battery = (percent: number, charging: boolean) =>
    seed(useProviderStore, { states: { ...useProviderStore.getInitialState().states, battery: { data: { percent, charging, pluggedIn: charging, secondsRemaining: null }, stale: false, issue: null } } });

  it("shows the charge, charging, and a warning colour when it is low", () => {
    battery(72, false);
    expect(face("battery")).toContain('aria-label="Battery 72%"');
    battery(72, true);
    expect(face("battery")).toContain("Battery 72%, Charging");
    battery(12, false);
    expect(face("battery")).toContain('data-low="true"');
    expect(face("battery")).toContain("var(--danger)");
    battery(12, true);
    expect(face("battery")).not.toContain('data-low="true"');
  });

  it("says there is no battery on a desktop", () => {
    seed(useProviderStore, { states: { ...useProviderStore.getInitialState().states, battery: { data: null, stale: false, issue: "no-device" } } });
    expect(face("battery")).toContain('aria-label="No battery"');
  });

  it("draws a round face with twelve marks and two hands", () => {
    const html = face("analog");
    expect(html.match(/<circle/g)).toHaveLength(13);
    expect(html.match(/<line/g)).toHaveLength(2);
  });
});

describe("notes", () => {
  const note = (id: string, title: string, body: string, pinned = false) => ({ id, title, body, color: "plain" as const, pinned });
  const setNotes = (notes: ReturnType<typeof note>[]) => seed(useNotesStore, { notes, activeId: notes[0]?.id ?? null });

  it("has a state for no notes, in the tile and the popover", () => {
    setNotes([]);
    expect(face("notes")).toContain("No notes yet");
    expect(popover("notes")).toContain("Notes you write here show on the home screen too.");
  });

  it("leads with the pinned note, or the first line, and counts them", () => {
    setNotes([note("1", "", "Plain\nsecond line"), note("2", "Shopping", "milk", true)]);
    const html = face("notes");
    expect(html).toContain("Shopping");
    expect(html).toContain("2 notes");
    setNotes([note("1", "", "First line\nsecond")]);
    expect(face("notes")).toContain("First line");
    expect(face("notes")).toContain("1 note");
  });

  it("shows every note as a tab, and the open one in an editor with pin and delete", () => {
    setNotes([note("1", "Shopping", "milk\neggs", true), note("2", "", "Ideas")]);
    const html = popover("notes");
    expect(button(html, "Shopping")).toContain('aria-selected="true"');
    expect(button(html, "Ideas")).toBeDefined();
    expect(html).toContain('aria-label="New note"');
    expect(html).toContain("milk");
    expect(button(html, "Unpin Shopping")).toContain('aria-pressed="true"');
    expect(button(html, "Delete Shopping")).toBeDefined();
  });
});

describe("colour picker", () => {
  const setColours = (colours: string[]) => seed(useTools, { colours });
  const withDropper = (on: boolean) => {
    const w = window as unknown as { EyeDropper?: unknown };
    if (on) w.EyeDropper = class {};
    else delete w.EyeDropper;
  };

  it("shows the last colour on the tile, or the dropper before any", () => {
    setColours([]);
    expect(face("colour")).toContain('data-empty="true"');
    setColours(["#E94248", "#112233"]);
    const html = face("colour");
    expect(html).toContain("background:#E94248");
    expect(html).toContain('aria-label="Colour picker, #E94248"');
  });

  it("offers the screen picker, the last colours and a way to copy each, when the window has a picker", () => {
    withDropper(true);
    setColours(["#E94248", "#112233"]);
    const html = popover("colour");
    expect(html).toContain("Pick a colour from the screen");
    expect(html).toContain("rgb(233, 66, 72)");
    expect(button(html, "Copy #112233")).toBeDefined();
    withDropper(false);
  });

  it("invites the first pick, and says plainly when the window cannot pick from the screen", () => {
    withDropper(true);
    setColours([]);
    expect(popover("colour")).toContain("Pick one from anywhere on the screen and it is kept here.");
    withDropper(false);
    expect(popover("colour")).toContain("Not available");
  });
});

describe("converter", () => {
  const setup = (patch: Partial<ReturnType<typeof useTools.getInitialState>["conversion"]> = {}) =>
    seed(useTools, { conversion: { category: "length", from: "kilometer", to: "mile", amount: "1", ...patch } });

  it("writes the conversion that is set up, on the tile", () => {
    setup();
    const html = face("convert");
    expect(html).toContain("1 km = 0.621371 mi");
    expect(html).toContain("Length");
  });

  it("asks for a number when what was typed is not one", () => {
    setup({ amount: "abc" });
    expect(face("convert")).toContain("Type a number");
    expect(conversionText({ category: "length", from: "kilometer", to: "mile", amount: "abc" })).toBeNull();
  });

  it("follows the units that are chosen, including temperature", () => {
    setup({ category: "temperature", from: "celsius", to: "fahrenheit", amount: "100" });
    expect(face("convert")).toContain("100 °C = 212 °F");
  });

  it("has every category as a tab, the amount, both units and a swap in the popover", () => {
    setup();
    const html = popover("convert");
    for (const words of ["Length", "Mass", "Volume", "Temperature", "Speed", "Area", "Data"]) expect(button(html, words)).toBeDefined();
    expect(button(html, "Length")).toContain('aria-selected="true"');
    expect(html).toContain('aria-label="Swap units"');
    expect(html).toContain('aria-label="Copy the result"');
    expect(html).toContain("0.621371 mi");
    expect(html.match(/<select/g)).toHaveLength(2);
  });

  it("marks a bad amount invalid and disables copying it", () => {
    setup({ amount: "abc" });
    const html = popover("convert");
    expect(html).toContain('aria-invalid="true"');
    expect(button(html, "Copy the result")).toContain('disabled=""');
  });
});

describe("emoji", () => {
  it("shows the last one used on the tile, else a face", () => {
    seed(useTools, { emoji: [] });
    expect(face("emoji")).toContain("😀");
    seed(useTools, { emoji: ["🔥"] });
    expect(face("emoji")).toContain("🔥");
  });

  it("offers the groups and a grid of emoji to copy, with recent ones above", () => {
    seed(useTools, { emoji: ["🔥", "😀"] });
    const html = popover("emoji");
    for (const words of ["Faces", "Hands", "Animals", "Food", "Travel", "Objects", "Recent"]) expect(html).toContain(words);
    expect(button(html, "Copy 🔥")).toBeDefined();
    expect(html.match(/aria-label="Copy /g)?.length).toBeGreaterThan(60);
  });
});

describe("world clock", () => {
  it("has a state for no cities, and invites adding one", () => {
    seed(useTools, { cities: [] });
    const html = face("world");
    expect(html).toContain("No cities yet");
    expect(html).toContain("Add a city");
    expect(popover("world")).toContain("Add the places you keep time for.");
  });

  it("shows two cities on the tile, and every one in the popover with a way to remove it", () => {
    seed(useTools, { cities: ["tokyo", "london", "new-york"] });
    const html = face("world");
    expect(html).toContain('<span class="tile__title">Tokyo');
    expect(html).toContain('<span class="tile__sub caps">London');
    expect(html).not.toContain('<span class="tile__sub caps">New York');
    const open = popover("world");
    for (const city of ["Tokyo", "London", "New York"]) expect(button(open, `Remove ${city}`)).toBeDefined();
    expect(open).toContain("UTC+9");
  });

  it("offers cities to add that are not chosen yet, until the limit", () => {
    seed(useTools, { cities: ["tokyo"] });
    const html = popover("world");
    expect(button(html, "Add a city: London")).toBeDefined();
    expect(button(html, "Add a city: Tokyo")).toBeUndefined();
    seed(useTools, { cities: ["tokyo", "london", "paris", "berlin", "madrid", "rome"] });
    const full = popover("world");
    expect(full).toContain("Up to 6 cities. Remove one to add another.");
    expect(full).not.toContain('placeholder="Search cities"');
  });
});

describe("network", () => {
  it("shows the rates, download first", () => {
    feeds({ network: ready({ downBytesPerSec: 4_200_000, upBytesPerSec: 312_000 }) });
    const html = face("network");
    expect(html).toMatch(/4\.2\s?MB\/s/);
    expect(html).toMatch(/↑ 312\s?kB\/s/);
  });

  it("says why there is nothing to show", () => {
    feeds({ network: failed("offline") });
    expect(face("network")).toContain("Offline");
    expect(popover("network")).toContain("It updates when the connection is back.");
  });

  it("draws download and upload as two graphs of the last minute", () => {
    seed(useNetworkHistory, { samples: [{ at: Date.now() - 5000, down: 2_000_000, up: 100_000 }] });
    feeds({ network: ready({ downBytesPerSec: 2_000_000, upBytesPerSec: 100_000 }) });
    const html = popover("network");
    for (const words of ["Download", "Upload", "Last 60 seconds"]) expect(html).toContain(words);
    expect(html.match(/<svg class="graph"/g)).toHaveLength(2);
  });
});

describe("quick settings", () => {
  const togglesView = (patch: Partial<{ wifi: boolean | null; bluetooth: boolean | null; nightLight: boolean | null; brightness: number | null }> = {}) =>
    ready({ switches: { wifi: patch.wifi ?? true, bluetooth: patch.bluetooth === undefined ? false : patch.bluetooth, nightLight: patch.nightLight ?? false, doNotDisturb: false }, brightness: patch.brightness === undefined ? 0.7 : patch.brightness });

  it("shows each switch as it is set", () => {
    feeds({ toggles: togglesView() });
    const html = face("toggles");
    expect(button(html, "Wi-Fi, on")).toContain('aria-pressed="true"');
    expect(button(html, "Bluetooth, off")).toContain('aria-pressed="false"');
  });

  it("disables a switch the machine does not have, and says so", () => {
    feeds({ toggles: togglesView({ bluetooth: null }) });
    expect(button(face("toggles"), "Bluetooth, Not on this device")).toContain('disabled=""');
    expect(popover("toggles")).toContain("Not on this device");
  });

  it("lists all four switches and the brightness in the popover", () => {
    feeds({ toggles: togglesView() });
    const html = popover("toggles");
    for (const words of ["Wi-Fi", "Bluetooth", "Night light", "Do not disturb", "Brightness", "70%"]) expect(html).toContain(words);
    expect(html.match(/role="switch"/g)).toHaveLength(4);
  });

  it("has no slider to move when the display brightness cannot be set", () => {
    feeds({ toggles: togglesView({ brightness: null }) });
    expect(popover("toggles")).toMatch(/type="range"[^>]*disabled=""|disabled=""[^>]*type="range"/);
  });

  it("has a designed state for each reason the settings are missing", () => {
    feeds({ toggles: failed("unsupported") });
    expect(popover("toggles")).toContain("The dock service has not provided this yet.");
  });
});
