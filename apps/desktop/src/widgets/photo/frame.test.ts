import { describe, expect, it } from "vitest";
import { spanPx } from "../../lib/layout/grid";
import { PHOTO_SIZES } from "./config";
import { CENTRED, clampFraming, MAX_ZOOM, MIN_ZOOM, pan, place, wheelFactor, zoomAt, type Box, type Framing } from "./frame";

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

describe("clampFraming", () => {
  it("pulls every part inside its limits", () => {
    expect(clampFraming({ x: -1, y: 2, zoom: 9 })).toEqual({ x: 0, y: 1, zoom: MAX_ZOOM });
    expect(clampFraming({ x: 0.3, y: 0.6, zoom: 0.2 })).toEqual({ x: 0.3, y: 0.6, zoom: MIN_ZOOM });
  });

  it("turns a value that is not a number into the centred default instead of poisoning the layout", () => {
    expect(clampFraming({ x: Number.NaN, y: Number.POSITIVE_INFINITY, zoom: Number.NaN })).toEqual(CENTRED);
  });
});

describe("resizing the widget", () => {
  const metrics = { cell: 76, gap: 12, edge: 28 };
  /** Photo window of a footprint in cells, inside a 1 px widget border. */
  const windowOf = (w: number, h: number): Box => ({ w: spanPx(w, metrics) - 2, h: spanPx(h, metrics) - 2 });
  const footprints = PHOTO_SIZES.map((s) => windowOf(s.w, s.h));
  const photos: readonly Box[] = [wide, { w: 2000, h: 4000 }, { w: 3000, h: 3000 }, { w: 6000, h: 1000 }];
  const framings: readonly Framing[] = [
    CENTRED,
    { x: 0, y: 0, zoom: 1 },
    { x: 1, y: 1, zoom: 1 },
    { x: 0.8, y: 0.2, zoom: 2.5 },
    { x: 0.1, y: 0.9, zoom: MAX_ZOOM },
  ];

  it("keeps the photo covering the whole window at every preset, whatever the framing", () => {
    for (const photo of photos) {
      for (const box of footprints) {
        for (const framing of framings) {
          const p = place(box, photo, "fill", framing);
          expect(p.left).toBeLessThanOrEqual(1e-9);
          expect(p.top).toBeLessThanOrEqual(1e-9);
          expect(p.left + p.width).toBeGreaterThanOrEqual(box.w - 1e-9);
          expect(p.top + p.height).toBeGreaterThanOrEqual(box.h - 1e-9);
        }
      }
    }
  });

  it("keeps the photo's proportions at every preset", () => {
    for (const photo of photos) {
      for (const box of footprints) {
        const p = place(box, photo, "fill", { x: 0.7, y: 0.3, zoom: 1.7 });
        expect(p.width / p.height).toBeCloseTo(photo.w / photo.h, 6);
      }
    }
  });

  it("lays the photo out at its final size: zoom 1 is the least that covers, never a scaled-up copy", () => {
    for (const box of footprints) {
      const p = place(box, wide, "fill", CENTRED);
      expect(p.width >= box.w - 1e-9 && p.height >= box.h - 1e-9).toBe(true);
      expect(Math.abs(p.width - box.w) < 1e-9 || Math.abs(p.height - box.h) < 1e-9).toBe(true);
    }
  });

  it("keeps the saved focal point on the same fraction of the photo after a resize", () => {
    const framing = { x: 0.25, y: 0.75, zoom: 2 };
    for (const box of footprints) {
      const p = place(box, wide, "fill", framing);
      const spareX = box.w - p.width;
      const spareY = box.h - p.height;
      expect(spareX === 0 ? framing.x : p.left / spareX).toBeCloseTo(framing.x, 6);
      expect(spareY === 0 ? framing.y : p.top / spareY).toBeCloseTo(framing.y, 6);
    }
  });

  it("lets the user keep dragging from the saved framing in the new frame", () => {
    const small = windowOf(2, 2);
    const next = pan(small, wide, { x: 0.25, y: 0.5, zoom: 1 }, 20, 0);
    expect(next.x).toBeLessThan(0.25);
    expect(place(small, wide, "fill", next).left).toBeLessThanOrEqual(0);
  });

  it("shows the whole photo at every preset in fit mode", () => {
    for (const photo of photos) {
      for (const box of footprints) {
        const p = place(box, photo, "fit", CENTRED);
        expect(p.width).toBeLessThanOrEqual(box.w + 1e-9);
        expect(p.height).toBeLessThanOrEqual(box.h + 1e-9);
        expect(p.left).toBeGreaterThanOrEqual(-1e-9);
        expect(p.top).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });
});
