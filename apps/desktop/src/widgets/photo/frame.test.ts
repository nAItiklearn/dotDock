import { describe, expect, it } from "vitest";
import { CENTRED, MAX_ZOOM, pan, place, wheelFactor, zoomAt } from "./frame";

const frame = { w: 200, h: 200 };
const wide = { w: 4000, h: 2000 };

describe("place", () => {
  it("fill covers the frame and centres by default", () => {
    const p = place(frame, wide, "fill", CENTRED);
    expect(p.height).toBe(200);
    expect(p.width).toBe(400);
    expect(p.left).toBe(-100);
    expect(p.top).toBe(0);
  });

  it("fit shows the whole photo, centred", () => {
    const p = place(frame, wide, "fit", CENTRED);
    expect(p).toEqual({ left: 0, top: 50, width: 200, height: 100 });
  });

  it("focal 0 shows the left edge and 1 the right edge", () => {
    expect(place(frame, wide, "fill", { x: 0, y: 0.5, zoom: 1 }).left).toBe(0);
    expect(place(frame, wide, "fill", { x: 1, y: 0.5, zoom: 1 }).left).toBe(-200);
  });

  it("zoom grows the laid-out size instead of scaling pixels", () => {
    const p = place(frame, wide, "fill", { ...CENTRED, zoom: 2 });
    expect(p.width).toBe(800);
    expect(p.height).toBe(400);
  });

  it("an empty frame or photo gives an empty rectangle", () => {
    expect(place({ w: 0, h: 10 }, wide, "fill", CENTRED).width).toBe(0);
  });
});

describe("pan", () => {
  it("dragging right moves towards the left edge of the photo", () => {
    const next = pan(frame, wide, CENTRED, 50, 0);
    expect(place(frame, wide, "fill", next).left).toBeCloseTo(-50);
  });

  it("never drags the photo off the frame", () => {
    const next = pan(frame, wide, CENTRED, 5000, 5000);
    expect(next.x).toBe(0);
    expect(place(frame, wide, "fill", next).left).toBe(0);
  });

  it("keeps the vertical focal point when there is nothing to pan", () => {
    expect(pan(frame, wide, CENTRED, 0, 40).y).toBe(0.5);
  });
});

describe("zoomAt", () => {
  it("keeps the point under the cursor still", () => {
    const at = { x: 60, y: 120 };
    const before = place(frame, wide, "fill", CENTRED);
    const u = (at.x - before.left) / before.width;
    const v = (at.y - before.top) / before.height;
    const after = place(frame, wide, "fill", zoomAt(frame, wide, CENTRED, 1.5, at.x, at.y));
    expect(after.left + u * after.width).toBeCloseTo(at.x);
    expect(after.top + v * after.height).toBeCloseTo(at.y);
  });

  it("is clamped to the zoom range", () => {
    expect(zoomAt(frame, wide, CENTRED, 100, 100, 100).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(frame, wide, CENTRED, 0.01, 100, 100).zoom).toBe(1);
  });
});

describe("wheelFactor", () => {
  it("zooms in on a negative delta and out on a positive one", () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(-100) * wheelFactor(100)).toBeCloseTo(1);
  });
});
