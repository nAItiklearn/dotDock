import { describe, expect, it } from "vitest";
import { CITIES } from "./data/cities";
import { isDaylight, isDaylightByHour, solarElevation } from "./solar";
import { fieldsDayDifference, formatUtcOffset, resolveZone, utcOffsetMinutes, zonedFields } from "./zones";

const utc = (iso: string): Date => new Date(iso);

describe("zonedFields", () => {
  it("reads the wall clock of another zone", () => {
    const f = zonedFields(utc("2026-11-19T12:00:00Z"), "Asia/Tokyo");
    expect(f).toMatchObject({ year: 2026, month: 10, day: 19, hour: 21, minute: 0, weekday: 4 });
  });

  it("rolls the date over", () => {
    const f = zonedFields(utc("2026-11-19T20:30:00Z"), "Asia/Kolkata");
    expect(f).toMatchObject({ day: 20, hour: 2, minute: 0 });
  });

  it("reports midnight as hour 0, not 24", () => {
    expect(zonedFields(utc("2026-11-19T00:00:00Z"), "UTC").hour).toBe(0);
  });

  it("follows daylight saving", () => {
    expect(zonedFields(utc("2026-01-15T12:00:00Z"), "America/New_York").hour).toBe(7);
    expect(zonedFields(utc("2026-07-15T12:00:00Z"), "America/New_York").hour).toBe(8);
  });
});

describe("offsets", () => {
  it("measures the UTC offset in minutes, half hours included", () => {
    const now = utc("2026-11-19T12:00:00Z");
    expect(utcOffsetMinutes(now, "Asia/Kolkata")).toBe(330);
    expect(utcOffsetMinutes(now, "America/New_York")).toBe(-300);
    expect(utcOffsetMinutes(now, "Europe/London")).toBe(0);
  });

  it("formats offsets", () => {
    expect(formatUtcOffset(0)).toBe("UTC");
    expect(formatUtcOffset(330)).toBe("UTC+5:30");
    expect(formatUtcOffset(-480)).toBe("UTC-8");
    expect(formatUtcOffset(540)).toBe("UTC+9");
  });

  it("counts the day difference between two places", () => {
    const now = utc("2026-11-19T20:30:00Z");
    const here = zonedFields(now, "America/New_York");
    expect(fieldsDayDifference(here, zonedFields(now, "Asia/Tokyo"))).toBe(1);
    expect(fieldsDayDifference(here, zonedFields(now, "Pacific/Honolulu"))).toBe(0);
    expect(fieldsDayDifference(zonedFields(utc("2026-11-19T03:00:00Z"), "UTC"), zonedFields(utc("2026-11-19T03:00:00Z"), "America/Los_Angeles"))).toBe(-1);
  });
});

describe("cities", () => {
  it("has unique ids and valid zones and coordinates", () => {
    expect(new Set(CITIES.map((c) => c.id)).size).toBe(CITIES.length);
    for (const c of CITIES) {
      expect(() => zonedFields(new Date(), c.timeZone), c.id).not.toThrow();
      expect(Math.abs(c.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(c.lon)).toBeLessThanOrEqual(180);
    }
  });

  it("agrees with the platform about each city's longitude band", () => {
    // Standard time is within about two hours of mean solar time; DST adds one more.
    const january = utc("2026-01-15T12:00:00Z");
    const july = utc("2026-07-15T12:00:00Z");
    for (const c of CITIES) {
      const solarHours = c.lon / 15;
      for (const when of [january, july]) {
        const offsetHours = utcOffsetMinutes(when, c.timeZone) / 60;
        expect(Math.abs(offsetHours - solarHours), c.id).toBeLessThan(4);
      }
    }
  });

  it("resolves a city id, and the device zone", () => {
    expect(resolveZone("tokyo", "Europe/London")).toMatchObject({ name: "Tokyo", timeZone: "Asia/Tokyo" });
    const local = resolveZone("local", "Asia/Kolkata");
    expect(local).toMatchObject({ id: "local", name: "Kolkata", timeZone: "Asia/Kolkata" });
    expect(local.coords).not.toBeNull();
    expect(resolveZone("local", "Pacific/Chatham").coords).toBeNull();
    expect(resolveZone("not-a-city", "Europe/London").id).toBe("local");
  });
});

describe("solar elevation", () => {
  it("puts the sun high at local noon in midsummer and well below the horizon at midnight", () => {
    // Greenwich-ish, solstice. Noon elevation is about 90 - 51.5 + 23.4 = 62 degrees.
    expect(solarElevation(utc("2026-06-21T12:00:00Z"), 51.5, 0)).toBeGreaterThan(60);
    expect(solarElevation(utc("2026-06-21T12:00:00Z"), 51.5, 0)).toBeLessThan(64);
    expect(solarElevation(utc("2026-06-21T00:00:00Z"), 51.5, 0)).toBeLessThan(-12);
  });

  it("is about 90 degrees at the equator at the equinox noon", () => {
    expect(solarElevation(utc("2026-03-20T12:00:00Z"), 0, 0)).toBeGreaterThan(85);
  });

  it("gives the polar regions their long days and nights", () => {
    expect(isDaylight(utc("2026-06-21T00:00:00Z"), 78.2, 15.6)).toBe(true);
    expect(isDaylight(utc("2026-12-21T12:00:00Z"), 78.2, 15.6)).toBe(false);
  });

  it("switches around real sunrise and sunset", () => {
    // London, 21 June 2026: sunrise about 03:43 UTC, sunset about 20:21 UTC.
    expect(isDaylight(utc("2026-06-21T03:15:00Z"), 51.51, -0.13)).toBe(false);
    expect(isDaylight(utc("2026-06-21T04:15:00Z"), 51.51, -0.13)).toBe(true);
    expect(isDaylight(utc("2026-06-21T19:50:00Z"), 51.51, -0.13)).toBe(true);
    expect(isDaylight(utc("2026-06-21T21:00:00Z"), 51.51, -0.13)).toBe(false);
  });

  it("falls back to a fixed day for places without coordinates", () => {
    expect(isDaylightByHour(5)).toBe(false);
    expect(isDaylightByHour(6)).toBe(true);
    expect(isDaylightByHour(17)).toBe(true);
    expect(isDaylightByHour(18)).toBe(false);
  });
});
