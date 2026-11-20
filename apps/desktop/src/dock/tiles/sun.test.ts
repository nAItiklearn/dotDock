import { describe, expect, it } from "vitest";
import { arcFraction, arcPoint, homeCity, nextEvent, sunDay } from "./sun";

const MIN = 60_000;
const utc = (iso: string): number => Date.parse(iso);
/** Published sunrise and sunset times (rounded to the minute) are matched within this. */
const TOLERANCE = 3 * MIN;

describe("the sun's day", () => {
  it("matches London at the June solstice", () => {
    const day = sunDay(utc("2026-06-21T12:00:00Z"), 51.51, -0.13);
    if (day.kind !== "day") throw new Error("expected a day");
    expect(Math.abs(day.sunrise - utc("2026-06-21T03:43:00Z"))).toBeLessThan(TOLERANCE);
    expect(Math.abs(day.sunset - utc("2026-06-21T20:21:00Z"))).toBeLessThan(TOLERANCE);
  });

  it("matches Mumbai in November", () => {
    const day = sunDay(utc("2026-11-20T06:30:00Z"), 19.08, 72.88);
    if (day.kind !== "day") throw new Error("expected a day");
    expect(Math.abs(day.sunrise - utc("2026-11-20T01:21:00Z"))).toBeLessThan(TOLERANCE);
    expect(Math.abs(day.sunset - utc("2026-11-20T12:30:00Z"))).toBeLessThan(TOLERANCE);
  });

  it("knows the polar night and the midnight sun", () => {
    expect(sunDay(utc("2026-12-21T12:00:00Z"), 78.22, 15.65).kind).toBe("night");
    expect(sunDay(utc("2026-06-21T12:00:00Z"), 78.22, 15.65).kind).toBe("midnight-sun");
  });
});

describe("the arc", () => {
  it("runs from 0 at sunrise to 1 at sunset, and is outside that at night", () => {
    const day = { kind: "day", sunrise: 1000, sunset: 3000, noon: 2000 } as const;
    expect(arcFraction(1000, day)).toBe(0);
    expect(arcFraction(2000, day)).toBe(0.5);
    expect(arcFraction(3000, day)).toBe(1);
    expect(arcFraction(4000, day)).toBeGreaterThan(1);
    expect(arcFraction(5, { kind: "night", noon: 0 })).toBeLessThan(0);
  });

  it("puts the sun on a half circle, highest at noon", () => {
    expect(arcPoint(0).x).toBeCloseTo(-1);
    expect(arcPoint(0).y).toBeCloseTo(0);
    expect(arcPoint(0.5).y).toBeCloseTo(1);
    expect(arcPoint(1).x).toBeCloseTo(1);
    expect(arcPoint(7)).toEqual(arcPoint(1));
  });
});

describe("the next event", () => {
  it("is sunset in the afternoon and tomorrow's sunrise after dark", () => {
    expect(nextEvent(utc("2026-06-21T15:00:00Z"), 51.51, -0.13)?.kind).toBe("sunset");
    const night = nextEvent(utc("2026-06-21T22:00:00Z"), 51.51, -0.13);
    expect(night?.kind).toBe("sunrise");
    expect((night?.at ?? 0) > utc("2026-06-22T03:00:00Z")).toBe(true);
  });

  it("is none in the polar night", () => {
    expect(nextEvent(utc("2026-12-21T12:00:00Z"), 89.9, 0)).toBeNull();
  });
});

describe("the home city", () => {
  it("is the bundled city in the device's time zone", () => {
    expect(homeCity("Asia/Kolkata")?.timeZone).toBe("Asia/Kolkata");
    expect(homeCity("Europe/London")?.id).toBe("london");
    expect(homeCity("Etc/Unknown")).toBeNull();
  });
});
