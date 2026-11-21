import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stopwatchElapsed } from "../tiles/format";
import type { FeedName, TileFeeds } from "../tiles/ui-types";
import { AUDIO, createDevTiles, sampleNetwork, TOGGLES, type DevTiles } from "./devTiles";

/**
 * The dev backend is the dock's test harness: every tile is driven through it in the browser. These tests hold it to the
 * contract the core has to meet, so a tile that works against the harness works against the core.
 */

const MIN = 60_000;
let now = 1_700_000_000_000;
let tiles: DevTiles;
/** Latest value of each feed, as the store would hold it. */
let feeds: Partial<TileFeeds>;
let stop: () => void = () => undefined;

const listen = (names: readonly FeedName[]): void => {
  stop = tiles.backend.subscribe(names, (changes) => {
    feeds = { ...feeds, ...changes };
  });
};

beforeEach(() => {
  now = 1_700_000_000_000;
  tiles = createDevTiles(() => now);
  feeds = {};
  stop = () => undefined;
});

afterEach(() => stop());

describe("feeds", () => {
  it("delivers the current value of each named feed at once, and only those", () => {
    listen(["mic", "audio"]);
    expect(Object.keys(feeds).sort()).toEqual(["audio", "mic"]);
    expect(feeds.mic).toEqual({ data: { muted: false }, issue: null });
  });

  it("pushes a change to the feeds that were asked for and not to others", () => {
    listen(["mic"]);
    tiles.outside.volume(0.1);
    expect(feeds.audio).toBeUndefined();
    tiles.outside.micMuted(true);
    expect(feeds.mic?.data).toEqual({ muted: true });
  });

  it("stops pushing once unsubscribed", () => {
    listen(["mic"]);
    stop();
    tiles.outside.micMuted(true);
    expect(feeds.mic?.data).toEqual({ muted: false });
  });

  it.each(["unsupported", "no-device", "offline", "error", "needs-setup"] as const)("puts a feed in the %s state and back", (issue) => {
    listen(["agenda", "contacts"]);
    tiles.setIssue("agenda", issue);
    expect(feeds.agenda).toEqual({ data: null, issue });
    expect(feeds.contacts?.issue).toBeNull();
    tiles.setIssue("agenda", null);
    expect(feeds.agenda?.issue).toBeNull();
    expect(feeds.agenda?.data).not.toBeNull();
  });
});

describe("stopwatch", () => {
  beforeEach(() => listen(["stopwatch"]));
  const view = () => tiles.state().stopwatch;

  it("starts, banks its time on pause and carries on from there", async () => {
    await tiles.backend.commands.stopwatch("start");
    now += 5000;
    await tiles.backend.commands.stopwatch("pause");
    expect(view()).toMatchObject({ running: false, bankedMs: 5000, startedAt: null });
    now += 60_000;
    expect(stopwatchElapsed(view(), now)).toBe(5000);
    await tiles.backend.commands.stopwatch("start");
    now += 2500;
    expect(stopwatchElapsed(view(), now)).toBe(7500);
  });

  it("records laps as elapsed time, only while running", async () => {
    await tiles.backend.commands.stopwatch("lap");
    expect(view().laps).toEqual([]);
    await tiles.backend.commands.stopwatch("start");
    now += 10_000;
    await tiles.backend.commands.stopwatch("lap");
    now += 15_000;
    await tiles.backend.commands.stopwatch("lap");
    expect(view().laps).toEqual([10_000, 25_000]);
  });

  it("resets everything, running or not", async () => {
    await tiles.backend.commands.stopwatch("start");
    now += 1000;
    await tiles.backend.commands.stopwatch("lap");
    await tiles.backend.commands.stopwatch("reset");
    expect(view()).toEqual({ running: false, startedAt: null, bankedMs: 0, laps: [] });
  });

  it("ignores a second start and a pause while stopped", async () => {
    await tiles.backend.commands.stopwatch("pause");
    expect(view().running).toBe(false);
    await tiles.backend.commands.stopwatch("start");
    const started = view().startedAt;
    now += 3000;
    await tiles.backend.commands.stopwatch("start");
    expect(view().startedAt).toBe(started);
  });

  it("pushes every change to the tile", async () => {
    await tiles.backend.commands.stopwatch("start");
    expect(feeds.stopwatch?.data?.running).toBe(true);
  });
});

describe("hydration", () => {
  beforeEach(() => listen(["hydration"]));
  const view = () => tiles.state().hydration;

  it("adds the glass and moves the next reminder a full interval away", async () => {
    const before = view().loggedMl;
    await tiles.backend.commands.hydration({ type: "log", ml: view().glassMl });
    expect(view().loggedMl).toBe(before + view().glassMl);
    expect(view().nextReminderAt).toBe(now + view().intervalMinutes * MIN);
  });

  it("snoozes the reminder by the minutes asked", async () => {
    const was = view().nextReminderAt ?? 0;
    await tiles.backend.commands.hydration({ type: "snooze", minutes: 30 });
    expect(view().nextReminderAt).toBe(was + 30 * MIN);
  });

  it("leaves reminders off when they were off", async () => {
    tiles.setHydration({ nextReminderAt: null });
    await tiles.backend.commands.hydration({ type: "log", ml: 250 });
    await tiles.backend.commands.hydration({ type: "snooze", minutes: 30 });
    expect(view().nextReminderAt).toBeNull();
  });
});

describe("microphone", () => {
  it("mutes and unmutes, and reflects a mute made elsewhere", async () => {
    listen(["mic"]);
    await tiles.backend.commands.toggleMic();
    expect(feeds.mic?.data).toEqual({ muted: true });
    tiles.outside.micMuted(false);
    expect(feeds.mic?.data).toEqual({ muted: false });
  });

  describe("level", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("is read only while somebody listens, and stops with the last listener", () => {
      expect(tiles.micWatchers()).toBe(0);
      const levels: number[] = [];
      const off = tiles.backend.watchMicLevel((l) => levels.push(l));
      expect(tiles.micWatchers()).toBe(1);
      vi.advanceTimersByTime(1000);
      expect(levels.length).toBeGreaterThanOrEqual(5);
      expect(levels.every((l) => l >= 0 && l <= 1)).toBe(true);
      off();
      expect(tiles.micWatchers()).toBe(0);
      const count = levels.length;
      vi.advanceTimersByTime(1000);
      expect(levels).toHaveLength(count);
    });

    it("keeps running for the others while one listener leaves", () => {
      const a: number[] = [];
      const b: number[] = [];
      const offA = tiles.backend.watchMicLevel((l) => a.push(l));
      const offB = tiles.backend.watchMicLevel((l) => b.push(l));
      offA();
      vi.advanceTimersByTime(500);
      expect(a).toHaveLength(0);
      expect(b.length).toBeGreaterThan(0);
      offB();
    });
  });
});

describe("audio", () => {
  beforeEach(() => listen(["audio"]));
  const view = () => tiles.state().audio;

  it("switches the output, with exactly one current", async () => {
    await tiles.backend.commands.audio({ type: "output", deviceId: "out-headphones" });
    expect(view().devices.filter((d) => d.current).map((d) => d.id)).toEqual(["out-headphones"]);
  });

  it("sets the volume, kept between zero and one", async () => {
    await tiles.backend.commands.audio({ type: "volume", value: 0.8 });
    expect(view().volume).toBe(0.8);
    await tiles.backend.commands.audio({ type: "volume", value: 4 });
    expect(view().volume).toBe(1);
    await tiles.backend.commands.audio({ type: "volume", value: -1 });
    expect(view().volume).toBe(0);
  });

  it("mutes and unmutes without losing the volume", async () => {
    await tiles.backend.commands.audio({ type: "mute", muted: true });
    expect(view()).toMatchObject({ muted: true, volume: AUDIO.volume });
    await tiles.backend.commands.audio({ type: "mute", muted: false });
    expect(view().muted).toBe(false);
  });

  it("follows the volume keys and a device that goes away", () => {
    tiles.outside.volume(0.12);
    expect(feeds.audio?.data?.volume).toBe(0.12);
    tiles.outside.devices(1);
    expect(feeds.audio?.data?.devices).toHaveLength(1);
    tiles.outside.devices(0);
    expect(feeds.audio?.data?.devices).toEqual([]);
  });
});

describe("commands", () => {
  it("log what the tiles asked for", async () => {
    await tiles.backend.commands.contact("c-maya", "video");
    await tiles.backend.commands.joinMeeting("https://example.test/join");
    expect(tiles.log()).toEqual(["contact c-maya video", "join https://example.test/join"]);
  });

  it("fail once with the reason given, then work again, and change nothing when they fail", async () => {
    listen(["mic"]);
    tiles.failNext("No microphone permission.");
    await expect(tiles.backend.commands.toggleMic()).rejects.toThrow("No microphone permission.");
    expect(tiles.state().mic.muted).toBe(false);
    await tiles.backend.commands.toggleMic();
    expect(tiles.state().mic.muted).toBe(true);
  });
});

describe("what the day holds", () => {
  it("has a meeting with a link, and can have one without or none at all", () => {
    const meeting = tiles.state().meeting;
    expect(meeting?.joinUrl).toEqual(expect.any(String));
    if (meeting) tiles.setMeeting({ ...meeting, joinUrl: null, service: null });
    expect(tiles.state().meeting?.joinUrl).toBeNull();
    listen(["meeting"]);
    tiles.setMeeting(null);
    expect(feeds.meeting).toEqual({ data: null, issue: null });
  });

  it("has people with only the ways that were set up", () => {
    const people = tiles.state().contacts.contacts;
    expect(people.length).toBeGreaterThan(2);
    expect(people.some((p) => p.channels.length === 1)).toBe(true);
    expect(people.some((p) => p.channels.length === 3)).toBe(true);
  });

  it("has a day with something over, something on now and something to come", () => {
    const { events } = tiles.state().agenda;
    expect(events.some((e) => !e.allDay && e.endsAt <= now)).toBe(true);
    expect(events.some((e) => e.startsAt <= now && now < e.endsAt)).toBe(true);
    expect(events.some((e) => e.startsAt > now)).toBe(true);
    expect(events.some((e) => e.allDay)).toBe(true);
  });
});

describe("network", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is measured only while somebody reads it, one sample a second", () => {
    expect(tiles.networkWatchers()).toBe(0);
    listen(["network"]);
    expect(tiles.networkWatchers()).toBe(1);
    const first = feeds.network?.data;
    vi.advanceTimersByTime(3000);
    expect(feeds.network?.data).not.toEqual(first);
    stop();
    expect(tiles.networkWatchers()).toBe(0);
    const frozen = feeds.network?.data;
    vi.advanceTimersByTime(5000);
    expect(feeds.network?.data).toEqual(frozen);
  });

  it("does not start measuring for a tile that reads something else", () => {
    listen(["mic"]);
    vi.advanceTimersByTime(3000);
    expect(feeds.network).toBeUndefined();
  });

  it("has rates that are whole numbers of bytes, never zero", () => {
    for (let second = 0; second < 60; second++) {
      const { downBytesPerSec, upBytesPerSec } = sampleNetwork(second);
      expect(Number.isInteger(downBytesPerSec) && downBytesPerSec > 0).toBe(true);
      expect(Number.isInteger(upBytesPerSec) && upBytesPerSec > 0).toBe(true);
    }
  });
});

describe("quick settings", () => {
  beforeEach(() => listen(["toggles"]));
  const view = () => tiles.state().toggles;

  it("switches a setting on and off", async () => {
    await tiles.backend.commands.toggles({ type: "switch", name: "nightLight", on: true });
    expect(view().switches.nightLight).toBe(true);
    await tiles.backend.commands.toggles({ type: "switch", name: "nightLight", on: false });
    expect(view().switches.nightLight).toBe(false);
    expect(feeds.toggles?.data?.switches.nightLight).toBe(false);
  });

  it("sets the brightness, kept between zero and one", async () => {
    await tiles.backend.commands.toggles({ type: "brightness", value: 0.3 });
    expect(view().brightness).toBe(0.3);
    await tiles.backend.commands.toggles({ type: "brightness", value: 3 });
    expect(view().brightness).toBe(1);
  });

  it("leaves a setting the machine does not have alone", async () => {
    tiles.setToggles({ ...TOGGLES, switches: { ...TOGGLES.switches, bluetooth: null }, brightness: null });
    await tiles.backend.commands.toggles({ type: "switch", name: "bluetooth", on: true });
    await tiles.backend.commands.toggles({ type: "brightness", value: 0.5 });
    expect(view().switches.bluetooth).toBeNull();
    expect(view().brightness).toBeNull();
  });

  it("follows a change made elsewhere", () => {
    tiles.outside.toggle("wifi", false);
    expect(feeds.toggles?.data?.switches.wifi).toBe(false);
  });
});
