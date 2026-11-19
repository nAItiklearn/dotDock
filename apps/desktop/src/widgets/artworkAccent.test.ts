import { describe, expect, it } from "vitest";
import { accentFromPixels } from "./artworkAccent";

describe("artwork accent", () => {
  const solid = (r: number, g: number, b: number, count = 64): number[] => Array.from({ length: count }, () => [r, g, b, 255]).flat();

  it("takes the colour of vivid art", () => {
    expect(accentFromPixels(solid(220, 40, 60))?.color).toBe("rgb(220 40 60)");
  });

  it("picks dark text on light colours and light text on dark ones", () => {
    expect(accentFromPixels(solid(240, 220, 90))?.ink).toBe("#111111");
    expect(accentFromPixels(solid(30, 60, 200))?.ink).toBe("#ffffff");
  });

  it("stays out of the way for grey, black, white and empty art", () => {
    expect(accentFromPixels(solid(128, 128, 128))).toBeNull();
    expect(accentFromPixels(solid(0, 0, 0))).toBeNull();
    expect(accentFromPixels(solid(255, 255, 255))).toBeNull();
    expect(accentFromPixels([])).toBeNull();
  });

  it("ignores transparent pixels", () => {
    const pixels = [...solid(10, 200, 30, 8), ...Array.from({ length: 64 }, () => [255, 0, 0, 0]).flat()];
    expect(accentFromPixels(pixels)?.color).toBe("rgb(10 200 30)");
  });

  it("averages mixed art toward its stronger colours", () => {
    const mixed = [...solid(255, 0, 0, 60), ...solid(0, 0, 255, 4)];
    const color = accentFromPixels(mixed)?.color ?? "";
    const [r = 0, , b = 0] = color.match(/\d+/g)?.map(Number) ?? [];
    expect(r).toBeGreaterThan(b);
  });
});
