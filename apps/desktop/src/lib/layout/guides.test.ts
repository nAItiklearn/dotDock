import { describe, expect, it } from "vitest";
import { computeGuides } from "./guides";

describe("alignment guides", () => {
  it("reports a shared left edge across both widgets' extent", () => {
    const guides = computeGuides({ x: 2, y: 4, w: 2, h: 2 }, [{ x: 2, y: 0, w: 3, h: 2 }]);
    expect(guides).toContainEqual({ axis: "x", edge: "start", at: 2, from: 0, to: 6 });
  });

  it("reports shared right edges and shared centres", () => {
    const edges = computeGuides({ x: 0, y: 4, w: 4, h: 2 }, [{ x: 2, y: 0, w: 2, h: 2 }]);
    expect(edges).toContainEqual({ axis: "x", edge: "end", at: 4, from: 0, to: 6 });
    const centres = computeGuides({ x: 1, y: 4, w: 2, h: 2 }, [{ x: 0, y: 0, w: 4, h: 2 }]);
    expect(centres).toContainEqual({ axis: "x", edge: "center", at: 2, from: 0, to: 6 });
  });

  it("works on the vertical axis too", () => {
    const guides = computeGuides({ x: 5, y: 1, w: 2, h: 2 }, [{ x: 0, y: 1, w: 2, h: 3 }]);
    expect(guides).toContainEqual({ axis: "y", edge: "start", at: 1, from: 0, to: 7 });
  });

  it("does not call a start against an end an alignment", () => {
    const guides = computeGuides({ x: 2, y: 0, w: 2, h: 2 }, [{ x: 0, y: 0, w: 2, h: 2 }]);
    expect(guides.filter((g) => g.axis === "x")).toEqual([]);
  });

  it("merges guides on the same line into one that spans all the widgets", () => {
    const guides = computeGuides({ x: 0, y: 3, w: 2, h: 1 }, [
      { x: 0, y: 0, w: 2, h: 1 },
      { x: 0, y: 6, w: 2, h: 1 },
    ]);
    const starts = guides.filter((g) => g.axis === "x" && g.edge === "start");
    expect(starts).toEqual([{ axis: "x", edge: "start", at: 0, from: 0, to: 7 }]);
  });

  it("returns nothing when nothing lines up", () => {
    expect(computeGuides({ x: 1, y: 1, w: 1, h: 1 }, [{ x: 3, y: 4, w: 2, h: 2 }])).toEqual([]);
  });
});
