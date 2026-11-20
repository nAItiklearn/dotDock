import { describe, expect, it, vi } from "vitest";
import { FeedHub, normalise, readFeed } from "./hub";
import type { FeedName, TileFeeds, TilesBackend } from "./ui-types";

/** A backend that records which feeds each subscription asked for and when it was cancelled. */
function recorder() {
  const subscriptions: { names: readonly FeedName[]; cancelled: boolean; push: (changes: Partial<TileFeeds>) => void }[] = [];
  const backend: TilesBackend = {
    commands: {} as TilesBackend["commands"],
    subscribe: (names, listener) => {
      const entry = { names, cancelled: false, push: listener };
      subscriptions.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    watchMicLevel: () => () => undefined,
  };
  return { backend, subscriptions };
}

describe("FeedHub", () => {
  it("asks for nothing until a tile needs a feed", () => {
    const { backend, subscriptions } = recorder();
    const hub = new FeedHub(() => backend, vi.fn());
    expect(subscriptions).toHaveLength(0);
    expect(hub.active()).toEqual([]);
  });

  it("subscribes to exactly the feeds that are shown, sorted", () => {
    const { backend, subscriptions } = recorder();
    const hub = new FeedHub(() => backend, vi.fn());
    hub.acquire("mic");
    hub.acquire("agenda");
    expect(subscriptions.at(-1)?.names).toEqual(["agenda", "mic"]);
  });

  it("renews the subscription when the set changes and cancels the old one", () => {
    const { backend, subscriptions } = recorder();
    const hub = new FeedHub(() => backend, vi.fn());
    hub.acquire("mic");
    hub.acquire("audio");
    expect(subscriptions).toHaveLength(2);
    expect(subscriptions[0]?.cancelled).toBe(true);
    expect(subscriptions[1]?.cancelled).toBe(false);
  });

  it("keeps a feed while any tile still shows it", () => {
    const { backend, subscriptions } = recorder();
    const hub = new FeedHub(() => backend, vi.fn());
    const first = hub.acquire("audio");
    const second = hub.acquire("audio");
    expect(subscriptions).toHaveLength(1);
    first();
    expect(hub.active()).toEqual(["audio"]);
    expect(subscriptions[0]?.cancelled).toBe(false);
    second();
    expect(hub.active()).toEqual([]);
    expect(subscriptions[0]?.cancelled).toBe(true);
  });

  it("ignores a release called twice", () => {
    const { backend } = recorder();
    const hub = new FeedHub(() => backend, vi.fn());
    const keep = hub.acquire("audio");
    const drop = hub.acquire("audio");
    drop();
    drop();
    expect(hub.active()).toEqual(["audio"]);
    keep();
    expect(hub.active()).toEqual([]);
  });

  it("hands what the core pushes to the store", () => {
    const { backend, subscriptions } = recorder();
    const deliver = vi.fn();
    const hub = new FeedHub(() => backend, deliver);
    hub.acquire("mic");
    subscriptions[0]?.push({ mic: { data: { muted: true }, issue: null } });
    expect(deliver).toHaveBeenCalledWith({ mic: { data: { muted: true }, issue: null } });
  });

  it("asks the current backend each time, so a fixture can replace the core", () => {
    const first = recorder();
    const second = recorder();
    let current = first.backend;
    const hub = new FeedHub(() => current, vi.fn());
    hub.acquire("mic");
    current = second.backend;
    hub.acquire("audio");
    expect(first.subscriptions).toHaveLength(1);
    expect(second.subscriptions[0]?.names).toEqual(["audio", "mic"]);
  });
});

describe("normalise", () => {
  it("reads a feed with neither data nor a reason as an error, not a crash", () => {
    expect(normalise({ audio: { data: null, issue: null } })).toEqual({ audio: { data: null, issue: "error" } });
  });

  it("leaves a day with no meeting alone: that is a state, not a failure", () => {
    expect(normalise({ meeting: { data: null, issue: null } })).toEqual({ meeting: { data: null, issue: null } });
  });

  it("passes good feeds and designed issues through", () => {
    const feeds: Partial<TileFeeds> = { mic: { data: { muted: false }, issue: null }, audio: { data: null, issue: "no-device" } };
    expect(normalise(feeds)).toEqual(feeds);
  });
});

describe("readFeed", () => {
  it("tells apart a feed on its way, one with a reason and one with data", () => {
    expect(readFeed(null)).toEqual({ state: "pending" });
    expect(readFeed({ data: null, issue: "offline" })).toEqual({ state: "issue", issue: "offline" });
    expect(readFeed({ data: { muted: true }, issue: null })).toEqual({ state: "ready", data: { muted: true } });
  });

  it("reads no meeting as ready with nothing in it", () => {
    expect(readFeed({ data: null, issue: null })).toEqual({ state: "ready", data: null });
  });
});
