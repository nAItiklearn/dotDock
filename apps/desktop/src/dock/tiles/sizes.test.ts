import { describe, expect, it } from "vitest";
import { buildEntries, lengthKind, TILE_IDS } from "../model";
import { canResize, parseSizes, sizeOf, withSize } from "./sizes";

describe("which tiles can change size", () => {
  it("is every tile that shows words beside its mark, and none that is only a mark", () => {
    expect(TILE_IDS.filter(canResize)).toEqual(["agenda", "meeting", "focus", "stopwatch", "reminders", "progress", "contacts", "notes", "convert", "world", "network"]);
    for (const id of ["clock", "media", "system", "hydration", "mic", "audio", "cpu", "battery", "analog", "colour", "emoji", "toggles"] as const) expect(canResize(id)).toBe(false);
  });
});

describe("sizeOf", () => {
  it("is regular unless the tile was made compact and can be", () => {
    expect(sizeOf(undefined, "agenda")).toBe("regular");
    expect(sizeOf({}, "agenda")).toBe("regular");
    expect(sizeOf({ agenda: "compact" }, "agenda")).toBe("compact");
    expect(sizeOf({ mic: "compact" }, "mic")).toBe("regular");
  });
});

describe("withSize", () => {
  it("stores only compact, so regular is just the absence of an entry", () => {
    const compact = withSize({}, "focus", "compact");
    expect(compact).toEqual({ focus: "compact" });
    expect(withSize(compact, "focus", "regular")).toEqual({});
  });

  it("changes one tile and leaves the others", () => {
    expect(withSize({ agenda: "compact" }, "focus", "compact")).toEqual({ agenda: "compact", focus: "compact" });
    expect(withSize({ agenda: "compact", focus: "compact" }, "agenda", "regular")).toEqual({ focus: "compact" });
  });

  it("does not change the object it was given", () => {
    const before = { agenda: "compact" } as const;
    withSize(before, "agenda", "regular");
    expect(before).toEqual({ agenda: "compact" });
  });
});

describe("parseSizes", () => {
  it("reads what was saved", () => {
    expect(parseSizes('{"agenda":"compact"}')).toEqual({ agenda: "compact" });
  });

  it("survives nothing saved, damage and the wrong shape", () => {
    expect(parseSizes(null)).toEqual({});
    expect(parseSizes("{nope")).toEqual({});
    expect(parseSizes("[1,2]")).toEqual({});
    expect(parseSizes("7")).toEqual({});
  });

  it("keeps only sizes that exist", () => {
    expect(parseSizes('{"agenda":"compact","focus":"huge","clock":3}')).toEqual({ agenda: "compact" });
  });
});

describe("a compact tile on the bar", () => {
  const input = { categories: [], apps: [], windows: [], settings: { pinned: [], tiles: ["agenda", "focus"] } };
  const options = { now: 0, seen: new Set<string>(), editing: false, status: false };

  it("is as long as an icon, and the others keep their length", () => {
    const entries = buildEntries(input, { ...options, sizes: { agenda: "compact" } });
    const tiles = entries.filter((e) => e.kind === "tile");
    expect(tiles.map((e) => lengthKind(e))).toEqual(["item", "focus"]);
    expect(tiles.map((e) => (e.kind === "tile" ? e.size : null))).toEqual(["compact", "regular"]);
  });

  it("is regular when no sizes are given", () => {
    const tiles = buildEntries(input, options).filter((e) => e.kind === "tile");
    expect(tiles.map((e) => lengthKind(e))).toEqual(["agenda", "focus"]);
  });
});
