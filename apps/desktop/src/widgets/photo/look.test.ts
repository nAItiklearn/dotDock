import { describe, expect, it } from "vitest";
import {
  bandFor,
  DOT_FILL,
  dotsPath,
  fitsRounded,
  layoutFrame,
  lookOf,
  lookVars,
  MIN_RING_DOTS,
  MIN_WINDOW_SHARE,
  POLAROID_FOOT,
  stadiumPerimeter,
  stadiumPoints,
  type Look,
  type LookSettings,
} from "./look";

const settings: LookSettings = {
  frame: "mat",
  shape: "rounded",
  radius: 28,
  thickness: 12,
  tint: "paper",
  caption: "",
  shadow: true,
};
const look = (over: Partial<LookSettings> = {}): Look => lookOf({ ...settings, ...over });

/** A 4 x 4 widget on the default grid: 4 cells of 76 px and 3 gaps of 12 px, inside a 1 px border each side. */
const large = { w: 4 * 76 + 3 * 12 - 2, h: 4 * 76 + 3 * 12 - 2 };
const small = { w: 2 * 76 + 12 - 2, h: 2 * 76 + 12 - 2 };
const wide = { w: 4 * 76 + 3 * 12 - 2, h: 2 * 76 + 12 - 2 };

describe("lookOf", () => {
  it("gives a polaroid a rounded rectangle whatever mask was chosen", () => {
    expect(look({ frame: "polaroid", shape: "circle" }).shape).toBe("rounded");
    expect(look({ frame: "mat", shape: "circle" }).shape).toBe("circle");
  });

  it("has no band without a border and prints a caption only on a polaroid", () => {
    expect(look({ frame: "none", thickness: 24 }).thickness).toBe(0);
    expect(look({ frame: "mat", caption: "Kyoto" }).caption).toBe("");
    expect(look({ frame: "polaroid", caption: "  Kyoto, May  " }).caption).toBe("Kyoto, May");
  });

  it("never lets a stored negative size through", () => {
    expect(look({ radius: -4, thickness: -8 })).toMatchObject({ radius: 0, thickness: 0 });
  });
});

describe("bandFor", () => {
  it("is the asked thickness while the photo keeps room", () => {
    expect(bandFor(look({ thickness: 12 }), large)).toBe(12);
  });

  it("is zero without a border", () => {
    expect(bandFor(look({ frame: "none" }), large)).toBe(0);
  });

  it("caps a thick border so the photo keeps its share on both axes", () => {
    const band = bandFor(look({ thickness: 60 }), small);
    expect(band).toBeLessThan(60);
    const window = small.w - 2 * band;
    expect(window / small.w).toBeGreaterThanOrEqual(MIN_WINDOW_SHARE - 1e-9);
  });

  it("caps a polaroid by its deeper foot on the short axis", () => {
    const band = bandFor(look({ frame: "polaroid", thickness: 32 }), wide);
    const used = band * (1 + POLAROID_FOOT);
    expect((wide.h - used) / wide.h).toBeGreaterThanOrEqual(MIN_WINDOW_SHARE - 1e-9);
  });
});

describe("layoutFrame", () => {
  it("fills the widget when there is no border", () => {
    const layout = layoutFrame(look({ frame: "none" }), large);
    expect(layout.insets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(layout.window).toEqual(large);
    expect(layout.dots).toHaveLength(0);
  });

  it("insets a mat and a keyline evenly", () => {
    for (const frame of ["mat", "hairline"] as const) {
      const layout = layoutFrame(look({ frame, thickness: 16 }), large);
      expect(layout.insets).toEqual({ top: 16, right: 16, bottom: 16, left: 16 });
      expect(layout.window).toEqual({ w: large.w - 32, h: large.h - 32 });
    }
  });

  it("gives a polaroid a foot POLAROID_FOOT times its sides", () => {
    const layout = layoutFrame(look({ frame: "polaroid", thickness: 12 }), large);
    expect(layout.insets).toEqual({ top: 12, right: 12, bottom: 12 * POLAROID_FOOT, left: 12 });
    expect(layout.window.h).toBe(large.h - 12 - 12 * POLAROID_FOOT);
  });

  it("has an empty window for an unmeasured widget", () => {
    expect(layoutFrame(look(), { w: 0, h: 0 }).window).toEqual({ w: 0, h: 0 });
  });

  it("re-fits to every footprint a resize can land on without the window collapsing", () => {
    const footprints = [small, wide, large, { w: 2 * 76 + 12 - 2, h: 4 * 76 + 3 * 12 - 2 }, { w: 6 * 76 + 5 * 12 - 2, h: 2 * 76 + 12 - 2 }];
    for (const card of footprints) {
      for (const frame of ["hairline", "mat", "polaroid", "dots"] as const) {
        const layout = layoutFrame(look({ frame, thickness: 32 }), card);
        expect(layout.window.w).toBeGreaterThanOrEqual(card.w * MIN_WINDOW_SHARE - 1e-6);
        expect(layout.window.h).toBeGreaterThanOrEqual(card.h * MIN_WINDOW_SHARE - 1e-6);
      }
    }
  });
});

describe("dot-matrix border", () => {
  const dots = (card = large, over: Partial<LookSettings> = {}) => layoutFrame(look({ frame: "dots", ...over }), card);

  it("tiles each side with whole cells and shares the corner dots", () => {
    const layout = dots(large, { thickness: 12, radius: 0 });
    const cols = Math.round(large.w / 12);
    const rows = Math.round(large.h / 12);
    expect(layout.dots).toHaveLength(2 * cols + 2 * (rows - 2));
  });

  it("leaves out a dot a rounded corner would cut, and keeps the ones that fit", () => {
    const square = dots(large, { thickness: 12, radius: 0 });
    const rounded = dots(large, { thickness: 12, radius: 28 });
    expect(rounded.dots.length).toBeLessThan(square.dots.length);
    for (const d of rounded.dots) expect(fitsRounded(large, 28, d, rounded.dotRadius)).toBe(true);
    const corner = square.dots[0];
    expect(corner && fitsRounded(large, 28, corner, square.dotRadius)).toBe(false);
  });

  it("keeps every dot inside the widget and out of the photo window", () => {
    const layout = dots(wide, { thickness: 12 });
    const { insets, window } = layout;
    for (const d of layout.dots) {
      expect(d.x - layout.dotRadius).toBeGreaterThanOrEqual(0);
      expect(d.y - layout.dotRadius).toBeGreaterThanOrEqual(0);
      expect(d.x + layout.dotRadius).toBeLessThanOrEqual(wide.w);
      expect(d.y + layout.dotRadius).toBeLessThanOrEqual(wide.h);
      const inside = d.x > insets.left && d.x < insets.left + window.w && d.y > insets.top && d.y < insets.top + window.h;
      expect(inside).toBe(false);
    }
  });

  it("draws dots at DOT_FILL of their cell", () => {
    const layout = dots(large, { thickness: 12 });
    const cell = Math.min(layout.insets.left, layout.insets.top);
    expect(layout.dotRadius * 2).toBeCloseTo(cell * DOT_FILL, 5);
  });

  it("is symmetric left to right and top to bottom", () => {
    const layout = dots(large, { thickness: 16 });
    const key = (x: number, y: number): string => `${x.toFixed(3)},${y.toFixed(3)}`;
    const set = new Set(layout.dots.map((d) => key(d.x, d.y)));
    for (const d of layout.dots) {
      expect(set.has(key(large.w - d.x, d.y))).toBe(true);
      expect(set.has(key(d.x, large.h - d.y))).toBe(true);
    }
  });

  it("puts the ring on a pill half a cell inside the edge for the circle shape", () => {
    const layout = dots(wide, { thickness: 12, shape: "circle" });
    const band = bandFor(look({ frame: "dots", thickness: 12 }), wide);
    const r = (wide.h - band) / 2;
    const half = (wide.w - wide.h) / 2;
    expect(layout.dots.length).toBeGreaterThanOrEqual(MIN_RING_DOTS);
    expect(layout.dots.length % 2).toBe(0);
    for (const d of layout.dots) {
      // Every dot is one end radius from the pill's spine, the segment between its two end centres.
      const x = Math.max(0, Math.abs(d.x - wide.w / 2) - half);
      expect(Math.hypot(x, d.y - wide.h / 2)).toBeCloseTo(r, 5);
    }
    expect(layout.insets).toEqual({ top: band, right: band, bottom: band, left: band });
  });

  it("is symmetric on both axes for the circle shape, wide, tall and square", () => {
    for (const card of [wide, { w: wide.h, h: wide.w }, large]) {
      const layout = dots(card, { thickness: 12, shape: "circle" });
      const key = (x: number, y: number): string => `${x.toFixed(2)},${y.toFixed(2)}`;
      const set = new Set(layout.dots.map((d) => key(d.x, d.y)));
      for (const d of layout.dots) {
        expect(set.has(key(card.w - d.x, d.y))).toBe(true);
        expect(set.has(key(d.x, card.h - d.y))).toBe(true);
      }
    }
  });
});

describe("stadiumPoints", () => {
  it("starts on a long side and spaces points evenly on straight runs and round ends", () => {
    const w = 300;
    const h = 100;
    const count = 40;
    const points = stadiumPoints(w, h, count);
    expect(points).toHaveLength(count);
    expect(points[0]?.x).toBeCloseTo(0, 6);
    expect(points[0]?.y).toBeCloseTo(-h / 2, 6);
    const along = stadiumPerimeter(w, h) / count;
    const gaps = points.map((p, i) => {
      const next = points[(i + 1) % count] ?? p;
      return Math.hypot(next.x - p.x, next.y - p.y);
    });
    // A chord across a round end is a little shorter than the arc it spans.
    for (const g of gaps) expect(Math.abs(g - along) / along).toBeLessThan(0.03);
  });

  it("is a circle when the sides match, and stands upright when tall", () => {
    for (const p of stadiumPoints(80, 80, 8)) expect(Math.hypot(p.x, p.y)).toBeCloseTo(40, 6);
    for (const p of stadiumPoints(100, 300, 24)) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(50 + 1e-9);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(150 + 1e-9);
    }
  });

  it("has the perimeter of two straight runs and one whole circle", () => {
    expect(stadiumPerimeter(300, 100)).toBeCloseTo(2 * 200 + Math.PI * 100, 9);
    expect(stadiumPerimeter(100, 300)).toBeCloseTo(stadiumPerimeter(300, 100), 9);
  });
});

describe("dotsPath and lookVars", () => {
  it("draws one closed circle per dot", () => {
    const path = dotsPath(
      [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
      ],
      2,
    );
    expect(path.match(/M/g)).toHaveLength(2);
    expect(path).toBe("M8 10a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M28 10a2 2 0 1 0 4 0a2 2 0 1 0 -4 0");
  });

  it("hands the stylesheet the insets and both radii as lengths", () => {
    const l = look({ frame: "polaroid", thickness: 12, radius: 20 });
    expect(lookVars(l, layoutFrame(l, large), large)).toEqual({
      "--photo-inset-t": "12px",
      "--photo-inset-r": "12px",
      "--photo-inset-b": "48px",
      "--photo-inset-l": "12px",
      "--photo-rx": "20px",
      "--photo-ry": "20px",
      "--photo-window-rx": "max(0px, calc(min(8px, var(--radius-sm)) - var(--hairline)))",
      "--photo-window-ry": "max(0px, calc(min(8px, var(--radius-sm)) - var(--hairline)))",
    });
  });

  it("follows the widget's corner exactly when there is no band", () => {
    const l = look({ frame: "none", radius: 28 });
    const vars = lookVars(l, layoutFrame(l, large), large);
    expect(vars["--photo-window-rx"]).toBe("max(0px, calc(28px - var(--hairline)))");
  });

  it("gives the circle shape fully round ends, a pill when wide, outside and inside the band", () => {
    const wide = { w: 340, h: 164 };
    const l = look({ frame: "mat", shape: "circle", thickness: 12 });
    const layout = layoutFrame(l, wide);
    const vars = lookVars(l, layout, wide);
    expect(vars["--photo-rx"]).toBe("calc(82px + var(--hairline))");
    expect(vars["--photo-ry"]).toBe("calc(82px + var(--hairline))");
    expect(vars["--photo-window-rx"]).toBe(`${layout.window.h / 2}px`);
    expect(vars["--photo-window-ry"]).toBe(`${layout.window.h / 2}px`);
  });
});
