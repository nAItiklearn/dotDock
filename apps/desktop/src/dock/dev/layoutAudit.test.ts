import { describe, expect, it } from "vitest";
import { centred, deviceGrid, gaps, hoverShift, overflow, type Box } from "./layoutAudit";

const box = (name: string, left: number, top: number, width: number, height: number): Box => ({ name, left, top, width, height });

describe("the pixel audit", () => {
  it("accepts edges on whole device pixels at 100, 125 and 150 % and flags the rest", () => {
    expect(deviceGrid([box("a", 10, 20, 48, 48)], 1)).toEqual([]);
    expect(deviceGrid([box("a", 10.4, 20, 48, 48)], 1.25)).toEqual([]);
    expect(deviceGrid([box("a", 10, 20, 48.6666667, 48)], 1.5)).toEqual([]);
    const [finding] = deviceGrid([box("tile", 10.5, 20, 110.4, 48)], 1);
    expect(finding?.check).toBe("device-pixel");
    expect(finding?.detail).toContain("left 10.500");
    expect(finding?.detail).toContain("right 120.900");
  });

  it("checks every gap along the dock against the spacing token", () => {
    const row = [box("a", 0, 0, 48, 48), box("b", 58, 0, 48, 48), box("c", 116, 0, 48, 48)];
    expect(gaps(row, 10, 1)).toEqual([]);
    const wrong = gaps([box("a", 0, 0, 48, 48), box("b", 62, 0, 48, 48)], 10, 1);
    expect(wrong[0]?.detail).toBe("14.00 px, token 10 px");
  });

  it("flags text that does not fit its box", () => {
    expect(overflow([{ name: "fits", scrollWidth: 80, clientWidth: 80, scrollHeight: 16, clientHeight: 16 }])).toEqual([]);
    expect(overflow([{ name: "cut", scrollWidth: 120, clientWidth: 80, scrollHeight: 16, clientHeight: 16 }])[0]?.name).toBe("cut");
  });

  it("flags content more than half a device pixel off its tile's centre", () => {
    const outer = box("tile", 0, 0, 100, 48);
    expect(centred([{ name: "ok", outer, inner: box("text", 10, 14.25, 60, 20) }], 2)).toEqual([]);
    expect(centred([{ name: "low", outer, inner: box("text", 10, 16, 60, 20) }], 1)[0]?.detail).toBe("2.00 px off centre");
  });

  it("flags anything that moves when the pointer only hovers", () => {
    const before = [box("a", 0, 0, 48, 48), box("b", 58, 0, 48, 48)];
    expect(hoverShift(before, before)).toEqual([]);
    expect(hoverShift(before, [box("a", 0, 0, 48, 48), box("b", 58, -1, 48, 48)])[0]?.name).toBe("b");
  });
});
