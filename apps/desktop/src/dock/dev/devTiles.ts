import { MS_PER_MINUTE } from "../../widgets/format";
import type {
  AgendaView,
  AudioOp,
  AudioView,
  ContactAction,
  ContactsView,
  FeedName,
  HydrationOp,
  HydrationView,
  MeetingView,
  MicView,
  NetworkView,
  RatesView,
  StopwatchOp,
  StopwatchView,
  TileFeeds,
  TileIssue,
  TilesBackend,
  ToggleName,
  TogglesOp,
  TogglesView,
} from "../tiles/ui-types";

/**
 * DEV ONLY. Stands in for the core's tile feeds, with the semantics the core promises: a stopwatch that banks its
 * time, a glass that fills and a reminder that moves, a microphone that mutes, an output that switches. The names
 * and numbers are invented for the fixture. `createDevTiles` takes the clock so the tests can drive time.
 */

const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MIC_LEVEL_EVERY_MS = 150;
const DEFAULT_MEETING_IN_MS = 12 * MS_PER_MINUTE;
const MEETING_LENGTH_MS = 45 * MS_PER_MINUTE;
const NETWORK_EVERY_MS = 1000;
const GLASS_ML = 250;
const GOAL_ML = 2000;
const REMINDER_EVERY_MIN = 60;
const NO_LAPS: readonly number[] = [];

export const CONTACTS: ContactsView = {
  contacts: [
    {
      id: "c-maya",
      name: "Maya Okafor",
      channels: [
        { action: "call", app: "Phone Link" },
        { action: "video", app: "Teams" },
        { action: "message", app: "WhatsApp" },
      ],
    },
    {
      id: "c-jonas",
      name: "Jonas Weber",
      channels: [
        { action: "call", app: "Phone Link" },
        { action: "message", app: "Signal" },
      ],
    },
    { id: "c-priya", name: "Priya Nair", channels: [{ action: "video", app: "Zoom" }] },
    { id: "c-tomas", name: "Tomas Lind", channels: [{ action: "message", app: "Discord" }] },
  ],
};

export const AUDIO: AudioView = {
  devices: [
    { id: "out-speakers", name: "Speakers (Realtek Audio)", kind: "speakers", current: true },
    { id: "out-headphones", name: "Headphones (Bluetooth)", kind: "headphones", current: false },
    { id: "out-monitor", name: "Monitor (HDMI)", kind: "other", current: false },
  ],
  volume: 0.46,
  muted: false,
};

const startOfDay = (now: number): number => {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** A day with one thing over, one on now, and three still to come, placed around `now`. */
export function sampleAgenda(now: number): AgendaView {
  const day = startOfDay(now);
  return {
    day,
    events: [
      { id: "e-over", title: "Standup", startsAt: now - 3 * MS_PER_HOUR, endsAt: now - 3 * MS_PER_HOUR + 15 * MS_PER_MINUTE, allDay: false, location: "Room 4" },
      { id: "e-now", title: "Design review", startsAt: now - 10 * MS_PER_MINUTE, endsAt: now + 50 * MS_PER_MINUTE, allDay: false, location: "Teams" },
      { id: "e-lunch", title: "Lunch with Priya", startsAt: now + 2 * MS_PER_HOUR, endsAt: now + 3 * MS_PER_HOUR, allDay: false, location: null },
      { id: "e-call", title: "Release planning", startsAt: now + 4 * MS_PER_HOUR, endsAt: now + 5 * MS_PER_HOUR, allDay: false, location: "Zoom" },
      { id: "e-day", title: "Dentist, afternoon off", startsAt: day, endsAt: day + 24 * MS_PER_HOUR, allDay: true, location: null },
    ],
  };
}

export const TOGGLES: TogglesView = { switches: { wifi: true, bluetooth: true, nightLight: false, doNotDisturb: false }, brightness: 0.7 };

/**
 * Reference rates for the fixture, quoted per euro like the European Central Bank's. Illustrative values for the
 * harness only; the core supplies the published ones.
 */
export const RATES: Omit<RatesView, "publishedAt"> = {
  base: "EUR",
  rates: { USD: 1.08, GBP: 0.84, INR: 91.2, JPY: 162.4, CHF: 0.95, AUD: 1.64, CAD: 1.5, CNY: 7.8, SEK: 11.4 },
};

/** A link that is busy in bursts: a download that comes and goes, and a trickle of upload. */
export function sampleNetwork(second: number): NetworkView {
  const burst = Math.max(0, Math.sin(second / 5)) ** 2;
  return { downBytesPerSec: Math.round(4_200_000 * burst + 30_000), upBytesPerSec: Math.round(312_000 * Math.abs(Math.sin(second / 3)) + 4_000) };
}

export function sampleMeeting(now: number, startsInMs = DEFAULT_MEETING_IN_MS, joinUrl: string | null = "https://teams.example/meet/dock-fixture"): MeetingView {
  return {
    id: "m-sync",
    title: "Weekly product sync",
    startsAt: now + startsInMs,
    endsAt: now + startsInMs + MEETING_LENGTH_MS,
    service: joinUrl === null ? null : "Teams",
    joinUrl,
    location: joinUrl === null ? "Room 2.14" : null,
  };
}

interface State {
  contacts: ContactsView;
  meeting: MeetingView | null;
  stopwatch: StopwatchView;
  mic: MicView;
  hydration: HydrationView;
  agenda: AgendaView;
  audio: AudioView;
  network: NetworkView;
  toggles: TogglesView;
  rates: RatesView;
}

type Listener = (changes: Partial<TileFeeds>) => void;

export interface DevTiles {
  readonly backend: TilesBackend;
  /** Commands the tiles sent, newest last. */
  readonly log: () => readonly string[];
  /** Makes the next command fail with this reason. */
  readonly failNext: (reason: string | null) => void;
  /** Puts a feed in one of its issue states; null puts the data back. */
  readonly setIssue: (feed: FeedName, issue: TileIssue | null) => void;
  readonly state: () => Readonly<State>;
  /** A change made outside the dock: the keyboard's volume keys, another app muting the microphone. */
  readonly outside: {
    readonly volume: (value: number) => void;
    readonly mute: (muted: boolean) => void;
    readonly micMuted: (muted: boolean) => void;
    readonly output: (deviceId: string) => void;
    readonly toggle: (name: ToggleName, on: boolean) => void;
    readonly devices: (count: number) => void;
  };
  readonly setContacts: (view: ContactsView) => void;
  readonly setToggles: (view: TogglesView) => void;
  /** How many listeners are reading the network; the core measures it only while one is. */
  readonly networkWatchers: () => number;
  readonly setMeeting: (meeting: MeetingView | null) => void;
  readonly setAgenda: (view: AgendaView) => void;
  readonly setHydration: (patch: Partial<HydrationView>) => void;
  /** How many listeners are reading the microphone level; the tile reads it only while unmuted. */
  readonly micWatchers: () => number;
}

export function createDevTiles(clock: () => number = Date.now): DevTiles {
  const now = clock();
  let state: State = {
    contacts: CONTACTS,
    meeting: sampleMeeting(now),
    stopwatch: { running: false, startedAt: null, bankedMs: 0, laps: NO_LAPS },
    mic: { muted: false },
    hydration: { goalMl: GOAL_ML, loggedMl: 750, glassMl: GLASS_ML, nextReminderAt: now + 25 * MS_PER_MINUTE, intervalMinutes: REMINDER_EVERY_MIN },
    agenda: sampleAgenda(now),
    audio: AUDIO,
    network: sampleNetwork(0),
    toggles: TOGGLES,
    rates: { ...RATES, publishedAt: startOfDay(now) },
  };
  const issues = new Map<FeedName, TileIssue>();
  const subscribers = new Set<{ readonly names: readonly FeedName[]; readonly listener: Listener }>();
  const micListeners = new Set<(level: number) => void>();
  const log: string[] = [];
  let failure: string | null = null;
  let micTimer: ReturnType<typeof setInterval> | null = null;
  let networkTimer: ReturnType<typeof setInterval> | null = null;
  let networkSecond = 0;

  const feed = <K extends FeedName>(name: K): TileFeeds[K] => {
    const issue = issues.get(name) ?? null;
    return (issue ? { data: null, issue } : { data: state[name], issue: null }) as TileFeeds[K];
  };
  const emit = (names: readonly FeedName[]): void => {
    for (const sub of subscribers) {
      const wanted = names.filter((n) => sub.names.includes(n));
      if (wanted.length > 0) sub.listener(Object.fromEntries(wanted.map((n) => [n, feed(n)])) as Partial<TileFeeds>);
    }
  };
  const set = <K extends FeedName>(name: K, value: State[K]): void => {
    state = { ...state, [name]: value };
    emit([name]);
  };

  const run = (line: string, change: () => void): Promise<void> => {
    log.push(line);
    if (log.length > 60) log.shift();
    if (failure !== null) {
      const reason = failure;
      failure = null;
      return Promise.reject(new Error(reason));
    }
    change();
    return Promise.resolve();
  };

  const elapsed = (): number => state.stopwatch.bankedMs + (state.stopwatch.running && state.stopwatch.startedAt !== null ? Math.max(0, clock() - state.stopwatch.startedAt) : 0);

  const stopwatch = (op: StopwatchOp): void => {
    const sw = state.stopwatch;
    switch (op) {
      case "start":
        if (!sw.running) set("stopwatch", { ...sw, running: true, startedAt: clock() });
        return;
      case "pause":
        if (sw.running) set("stopwatch", { ...sw, running: false, startedAt: null, bankedMs: elapsed() });
        return;
      case "lap":
        if (sw.running) set("stopwatch", { ...sw, laps: [...sw.laps, elapsed()] });
        return;
      case "reset":
        set("stopwatch", { running: false, startedAt: null, bankedMs: 0, laps: NO_LAPS });
    }
  };

  const hydration = (op: HydrationOp): void => {
    const h = state.hydration;
    if (op.type === "log") set("hydration", { ...h, loggedMl: h.loggedMl + op.ml, nextReminderAt: h.nextReminderAt === null ? null : clock() + h.intervalMinutes * MS_PER_MINUTE });
    else set("hydration", { ...h, nextReminderAt: h.nextReminderAt === null ? null : h.nextReminderAt + op.minutes * MS_PER_MINUTE });
  };

  const audio = (op: AudioOp): void => {
    const a = state.audio;
    if (op.type === "volume") set("audio", { ...a, volume: Math.min(1, Math.max(0, op.value)) });
    else if (op.type === "mute") set("audio", { ...a, muted: op.muted });
    else set("audio", { ...a, devices: a.devices.map((d) => ({ ...d, current: d.id === op.deviceId })) });
  };

  const toggles = (op: TogglesOp): void => {
    const view = state.toggles;
    if (op.type === "brightness") set("toggles", { ...view, brightness: view.brightness === null ? null : Math.min(1, Math.max(0, op.value)) });
    else if (view.switches[op.name] !== null) set("toggles", { ...view, switches: { ...view.switches, [op.name]: op.on } });
  };

  const watchesNetwork = (): boolean => [...subscribers].some((sub) => sub.names.includes("network"));
  const syncNetwork = (): void => {
    if (watchesNetwork() && networkTimer === null) {
      networkTimer = setInterval(() => {
        networkSecond += 1;
        set("network", sampleNetwork(networkSecond));
      }, NETWORK_EVERY_MS);
    } else if (!watchesNetwork() && networkTimer !== null) {
      clearInterval(networkTimer);
      networkTimer = null;
    }
  };

  const startMic = (): void => {
    if (micTimer !== null) return;
    let tick = 0;
    micTimer = setInterval(() => {
      tick += 1;
      // A voice-like level: a slow swell with quick flutter on top. Only the fixture ever produces it.
      const level = Math.abs(Math.sin(tick / 6)) * 0.7 + Math.abs(Math.sin(tick * 1.7)) * 0.3;
      micListeners.forEach((listener) => listener(level));
    }, MIC_LEVEL_EVERY_MS);
  };

  const backend: TilesBackend = {
    commands: {
      contact: (id: string, action: ContactAction) => run(`contact ${id} ${action}`, () => undefined),
      joinMeeting: (url) => run(`join ${url}`, () => undefined),
      stopwatch: (op) => run(`stopwatch ${op}`, () => stopwatch(op)),
      toggleMic: () => run("mic toggle", () => set("mic", { muted: !state.mic.muted })),
      hydration: (op) => run(`hydration ${op.type}`, () => hydration(op)),
      audio: (op) => run(`audio ${op.type}`, () => audio(op)),
      toggles: (op) => run(`toggles ${op.type}`, () => toggles(op)),
      quickSettings: () => run("quick settings", () => undefined),
      // The harness is a browser: the address opens in a new tab, as the core opens it in the default browser.
      openUrl: (url) => run(`open ${url}`, () => void globalThis.open?.(url, "_blank", "noopener")),
    },
    subscribe: (names, listener) => {
      const sub = { names, listener };
      subscribers.add(sub);
      syncNetwork();
      listener(Object.fromEntries(names.map((n) => [n, feed(n)])) as Partial<TileFeeds>);
      return () => {
        subscribers.delete(sub);
        syncNetwork();
      };
    },
    watchMicLevel: (listener) => {
      micListeners.add(listener);
      startMic();
      return () => {
        micListeners.delete(listener);
        if (micListeners.size === 0 && micTimer !== null) {
          clearInterval(micTimer);
          micTimer = null;
        }
      };
    },
  };

  return {
    backend,
    log: () => log,
    failNext: (reason) => {
      failure = reason;
    },
    setIssue: (name, issue) => {
      if (issue === null) issues.delete(name);
      else issues.set(name, issue);
      emit([name]);
    },
    state: () => state,
    outside: {
      volume: (value) => audio({ type: "volume", value }),
      mute: (muted) => audio({ type: "mute", muted }),
      micMuted: (muted) => set("mic", { muted }),
      output: (deviceId) => audio({ type: "output", deviceId }),
      toggle: (name, on) => toggles({ type: "switch", name, on }),
      devices: (count) => set("audio", { ...state.audio, devices: AUDIO.devices.slice(0, count).map((d, i) => ({ ...d, current: i === 0 })) }),
    },
    setContacts: (view) => set("contacts", view),
    setToggles: (view) => set("toggles", view),
    networkWatchers: () => [...subscribers].filter((sub) => sub.names.includes("network")).length,
    setMeeting: (meeting) => set("meeting", meeting),
    setAgenda: (view) => set("agenda", view),
    setHydration: (patch) => set("hydration", { ...state.hydration, ...patch }),
    micWatchers: () => micListeners.size,
  };
}

/** The fixture's own instance, used by the dev backend and the panel. */
export const devTiles = createDevTiles();
