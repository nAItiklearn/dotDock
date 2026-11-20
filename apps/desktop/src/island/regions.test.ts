import { describe, expect, it } from "vitest";
import { computeRegions, HIT_MARGIN, HOVER_MARGIN, sameRegions } from "./regions";

const REST = { x: 96, y: 10, w: 328, h: 101 };

describe("computeRegions", () => {
  it("makes the island clickable and watches a wider footprint when active", () => {
    const regions = computeRegions({ rest: REST, mode: "island", moveAside: true, aside: false });
    expect(regions.interactive).toEqual([{ x: 96 - HIT_MARGIN, y: 10 - HIT_MARGIN, w: 328 + 2 * HIT_MARGIN, h: 101 + 2 * HIT_MARGIN }]);
    expect(regions.hover).toEqual({ x: 96 - HOVER_MARGIN, y: 0, w: 328 + 2 * HOVER_MARGIN, h: 10 + 101 + HOVER_MARGIN });
  });

  it("lets every click through while the island is aside but keeps watching the resting footprint", () => {
    const regions = computeRegions({ rest: REST, mode: "island", moveAside: true, aside: true });
    expect(regions.interactive).toEqual([]);
    expect(regions.hover).not.toBeNull();
  });

  it("does not watch for hover when moving aside is off", () => {
    const regions = computeRegions({ rest: REST, mode: "island", moveAside: false, aside: false });
    expect(regions.hover).toBeNull();
    expect(regions.interactive).toHaveLength(1);
  });

  it.each(["hidden", "tiny"] as const)("asks for nothing in %s mode", (mode) => {
    expect(computeRegions({ rest: REST, mode, moveAside: true, aside: false })).toEqual({ interactive: [], hover: null });
  });

  it("starts the hover footprint at the screen edge so the gap above the island counts", () => {
    expect(computeRegions({ rest: REST, mode: "island", moveAside: true, aside: false }).hover?.y).toBe(0);
  });
});

describe("sameRegions", () => {
  const a = computeRegions({ rest: REST, mode: "island", moveAside: true, aside: false });

  it("recognises identical regions so the core is not told twice", () => {
    expect(sameRegions(a, computeRegions({ rest: { ...REST }, mode: "island", moveAside: true, aside: false }))).toBe(true);
  });

  it("notices a moved rectangle, a changed count and a missing hover footprint", () => {
    expect(sameRegions(a, computeRegions({ rest: { ...REST, x: 97 }, mode: "island", moveAside: true, aside: false }))).toBe(false);
    expect(sameRegions(a, computeRegions({ rest: REST, mode: "island", moveAside: true, aside: true }))).toBe(false);
    expect(sameRegions(a, computeRegions({ rest: REST, mode: "island", moveAside: false, aside: false }))).toBe(false);
  });

  it("treats two empty region sets as equal", () => {
    const empty = { interactive: [], hover: null };
    expect(sameRegions(empty, empty)).toBe(true);
  });
});
