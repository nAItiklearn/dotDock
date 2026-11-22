import { describe, expect, it } from "vitest";
import { beaufort, blowsToward, compassPoint } from "./wind";

describe("wind", () => {
  it("names the compass point it comes from", () => {
    expect(compassPoint(0)).toBe("N");
    expect(compassPoint(359)).toBe("N");
    expect(compassPoint(45)).toBe("NE");
    expect(compassPoint(202.5)).toBe("SSW");
    expect(compassPoint(-90)).toBe("W");
    expect(compassPoint(720 + 315)).toBe("NW");
  });

  it("points the arrow the way the air moves", () => {
    expect(blowsToward(0)).toBe(180);
    expect(blowsToward(270)).toBe(90);
  });

  it("gives the Beaufort force", () => {
    expect(beaufort(0)).toBe(0);
    expect(beaufort(15)).toBe(3);
    expect(beaufort(40)).toBe(6);
    expect(beaufort(150)).toBe(12);
  });
});
