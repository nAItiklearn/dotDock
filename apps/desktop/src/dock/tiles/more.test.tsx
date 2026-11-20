import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { TileId } from "../model";
import type { DockApp } from "../protocol";
import type { RatesView, TileFeeds } from "./ui-types";

/**
 * The flip clock, sun arc, wind, currency, web search, history and voice memo tiles, each drawn on the dock and as
 * its popover, in each state its data can be in. Server-rendered like `render.test.tsx`: one frame per state.
 */

vi.stubGlobal("window", { innerWidth: 1920, innerHeight: 1080, addEventListener: () => undefined, removeEventListener: () => undefined, matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }) });
vi.stubGlobal("document", { hidden: false, addEventListener: () => undefined, removeEventListener: () => undefined });
vi.stubGlobal("location", { search: "" });
vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
vi.stubGlobal("navigator", { onLine: true });

const { Tile } = await import("./Tile");
const { TilePopover } = await import("./popovers");
const { useTools } = await import("./toolsStore");
const { useFeedStore } = await import("./feeds");
const { useDockStore } = await import("../store");
const { useProviderStore } = await import("../../providers/store");
const { useMemos } = await import("./memoRecorder");

const noop = (): void => undefined;
const controls = { editing: false, open: false, onPress: noop, onActivate: noop, onPressKey: noop };
const face = (id: TileId): string => renderToStaticMarkup(<Tile id={id} controls={controls} />);
const popover = (id: Parameters<typeof TilePopover>[0]["open"]["id"]): string => renderToStaticMarkup(<TilePopover open={{ id, from: { x: 800, y: 980, w: 60, h: 60 } }} />);

function seed<S extends object>(store: { getInitialState: () => S; setState: (patch: Partial<S>) => void }, patch: Partial<S>): void {
  Object.assign(store.getInitialState(), patch);
  store.setState(patch);
}
const feeds = (next: Partial<TileFeeds>): void => seed(useFeedStore, { feeds: next });
const weather = (patch: Record<string, unknown> | null, issue: "offline" | null = null) =>
  seed(useProviderStore, {
    states: {
      ...useProviderStore.getInitialState().states,
      weather: { data: patch === null ? null : { place: "Pune", temperatureC: 24, highC: 29, lowC: 17, code: 1, isDay: true, fetchedAt: 0, ...patch }, stale: false, issue },
    },
  });

describe("flip clock", () => {
  it("shows the hours and minutes on two split cards", () => {
    const html = face("flip");
    expect(html.match(/class="flip__card"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-label="Flip clock, \d/);
  });
});

describe("sun arc", () => {
  it("follows the chosen city and names the next sunrise or sunset", () => {
    seed(useTools, { sunCity: "london" });
    const html = face("sun");
    expect(html).toContain("London");
    expect(html).toMatch(/Sunrise \d|Sunset \d|does not (rise|set)/);
    expect(html).toContain('class="sun-arc"');
  });

  it("asks for a place when the device's time zone has no city", () => {
    seed(useTools, { sunCity: "not-a-city" });
    expect(face("sun")).toContain("Choose a place");
    expect(popover("sun")).toContain("Pick the city nearest to you");
  });

  it("lists sunrise, sunset and daylight, and every city to choose from", () => {
    seed(useTools, { sunCity: "mumbai" });
    const html = popover("sun");
    for (const words of ["Sunrise", "Sunset", "Daylight", "Reykjavik", "Sydney"]) expect(html).toContain(words);
  });
});

describe("wind", () => {
  it("shows the speed, where it comes from and the gusts", () => {
    weather({ windKmh: 14, windFromDeg: 315, gustKmh: 26 });
    const html = face("wind");
    expect(html).toContain("14 km/h");
    expect(html).toContain("from the northwest");
    expect(html).toContain("gusts 26 km/h");
    expect(html).toContain("rotate(135deg)");
  });

  it("says when the weather has no wind yet, or is offline", () => {
    weather({});
    expect(face("wind")).toContain("Not available");
    weather(null, "offline");
    expect(face("wind")).toContain("Offline");
  });
});

describe("currency", () => {
  const rates: RatesView = { base: "EUR", publishedAt: Date.parse("2026-11-20T12:00:00Z"), rates: { USD: 1.1, INR: 92.5 } };

  it("converts the amount set up, in each currency's own format", () => {
    feeds({ rates: { data: rates, issue: null } });
    seed(useTools, { currency: { from: "EUR", to: "USD", amount: "10" } });
    expect(face("currency")).toContain("€10.00 = $11.00");
  });

  it("offers every currency with its name, a swap, and the date of the rates", () => {
    feeds({ rates: { data: rates, issue: null } });
    const html = popover("currency");
    expect(html).toContain("INR · Indian Rupee");
    expect(html).toContain('aria-label="Swap currencies"');
    expect(html).toContain("Reference rates of");
  });

  it("has a designed state when the core has no rates", () => {
    feeds({ rates: { data: null, issue: "unsupported" } });
    expect(face("currency")).toContain("Not available");
    expect(popover("currency")).toContain("The dock service has not provided this yet.");
  });
});

describe("web search", () => {
  it("opens a field for the chosen engine, and lists the engines", () => {
    seed(useTools, { engine: "ecosia" });
    expect(face("search")).toContain("Search the web");
    const html = popover("search");
    expect(html).toContain("Search with Ecosia or type an address");
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>Ecosia/);
    for (const name of ["DuckDuckGo", "Google", "Bing", "Brave Search"]) expect(html).toContain(name);
  });
});

describe("history", () => {
  const app = (id: string, name: string): DockApp => ({ id, name, category: "productivity", filedBy: "rule", icon: "", publisher: null, firstSeen: 0 });

  it("says nothing was opened yet", () => {
    seed(useTools, { recent: [] });
    expect(face("history")).toContain("Nothing opened yet");
    expect(popover("history")).toContain("Apps you open from the dock are listed here");
  });

  it("leads with the last app opened, and lists them with how long ago", () => {
    seed(useDockStore, { apps: [app("a", "Figma"), app("b", "Notion")] });
    seed(useTools, { recent: [{ appId: "b", at: Date.now() - 5 * 60_000 }, { appId: "a", at: Date.now() - 2 * 3_600_000 }, { appId: "gone", at: 0 }] });
    expect(face("history")).toContain("Notion");
    const html = popover("history");
    expect(html).toContain("5 min ago");
    expect(html).toContain("2 h ago");
    expect(html).not.toContain("gone");
    expect(html).toContain("Clear history");
  });
});

describe("voice memo", () => {
  it("is ready to record, and counts the memos kept", () => {
    seed(useMemos, { status: "idle", issue: null, memos: [{ id: "m1", createdAt: Date.now(), durationMs: 7400, peaks: [0.2, 0.8] }], levels: [], startedAt: null });
    expect(face("memo")).toContain("1 memo");
    const html = popover("memo");
    expect(html).toContain('aria-label="Record a memo"');
    expect(html).toContain("0:07");
    expect(html.match(/class="wave-bars wave-bars--saved"/g)).toHaveLength(1);
  });

  it("shows the time and a live waveform while recording", () => {
    seed(useMemos, { status: "recording", issue: null, startedAt: Date.now(), levels: [0.1, 0.5, 0.9], memos: [] });
    const html = face("memo");
    expect(html).toContain("Recording");
    expect(html).toContain('class="wave-bars wave-bars--face"');
    expect(popover("memo")).toContain('aria-label="Stop and keep the memo"');
  });

  it("says so when this window cannot record", () => {
    seed(useMemos, { status: "idle", issue: "unsupported", memos: [], levels: [], startedAt: null });
    expect(face("memo")).toContain("Not available");
    expect(popover("memo")).toContain("This window cannot record sound.");
  });
});
