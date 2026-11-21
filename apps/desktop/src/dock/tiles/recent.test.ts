import { describe, expect, it } from "vitest";
import { agoParts, MAX_RECENT, parseRecentLaunches, pushLaunch } from "./recent";

describe("the dock's history", () => {
  it("puts the latest launch first, once per app", () => {
    let list = pushLaunch([], "a", 1);
    list = pushLaunch(list, "b", 2);
    list = pushLaunch(list, "a", 3);
    expect(list).toEqual([
      { appId: "a", at: 3 },
      { appId: "b", at: 2 },
    ]);
  });

  it("keeps only the newest few", () => {
    let list = pushLaunch([], "app0", 0);
    for (let i = 1; i < 20; i += 1) list = pushLaunch(list, `app${i}`, i);
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]?.appId).toBe("app19");
  });

  it("reads back only well-formed, unique entries", () => {
    const raw = JSON.stringify([{ appId: "a", at: 2 }, { appId: "a", at: 1 }, { appId: 3, at: 1 }, null, { appId: "b", at: "x" }]);
    expect(parseRecentLaunches(raw)).toEqual([{ appId: "a", at: 2 }]);
    expect(parseRecentLaunches("not json")).toEqual([]);
    expect(parseRecentLaunches(null)).toEqual([]);
    expect(parseRecentLaunches("{}")).toEqual([]);
  });

  it("says how long ago in the units a row has room for", () => {
    const now = 10 * 24 * 3_600_000;
    expect(agoParts(now - 30_000, now)).toEqual({ unit: "now", count: 0 });
    expect(agoParts(now - 5 * 60_000, now)).toEqual({ unit: "min", count: 5 });
    expect(agoParts(now - 3 * 3_600_000, now)).toEqual({ unit: "h", count: 3 });
    expect(agoParts(now - 2 * 24 * 3_600_000, now)).toEqual({ unit: "d", count: 2 });
    expect(agoParts(now + 1000, now)).toEqual({ unit: "now", count: 0 });
  });
});
