import { afterEach, describe, expect, it, vi } from "vitest";
import { HISTORY_SIZE, inkFor, luminance, normaliseHex, parseHistory, remember, rgbText, toRgb } from "./colour";
import { EMOJI_GROUPS, emojiOf, parseRecent, pushRecent, RECENT_SIZE } from "./emoji";
import { appendRate, formatRate, MIN_SCALE_BYTES, rateLevels, scaleOf, type RateSample } from "./network";
import { CATEGORIES, convert, DEFAULT_PAIR, formatNumber, parseAmount, UNIT_CATEGORIES, unitIn, unitName, unitSymbol } from "./units";
import { addCity, cityChoices, MAX_CITIES, parseCities, removeCity, worldRows } from "./world";

describe("units", () => {
  const near = (actual: number, expected: number, digits = 6): void => expect(actual).toBeCloseTo(expected, digits);

  it("converts the lengths people ask about", () => {
    near(convert("length", "kilometer", "mile", 1), 0.621371, 5);
    near(convert("length", "mile", "kilometer", 1), 1.609344);
    near(convert("length", "inch", "centimeter", 1), 2.54);
    near(convert("length", "foot", "meter", 10), 3.048);
  });

  it("converts mass, volume, speed, area and data", () => {
    near(convert("mass", "stone", "pound", 1), 14, 4);
    near(convert("mass", "kilogram", "ounce", 1), 35.27396, 4);
    near(convert("volume", "gallon", "liter", 1), 3.785412, 5);
    near(convert("speed", "meter-per-second", "kilometer-per-hour", 1), 3.6);
    near(convert("speed", "mile-per-hour", "kilometer-per-hour", 60), 96.56064, 4);
    near(convert("area", "acre", "hectare", 1), 0.404686, 5);
    near(convert("data", "gigabyte", "megabyte", 1), 1000);
  });

  it("converts temperature, which is not a ratio", () => {
    near(convert("temperature", "celsius", "fahrenheit", 100), 212);
    near(convert("temperature", "celsius", "fahrenheit", 0), 32);
    near(convert("temperature", "fahrenheit", "celsius", -40), -40);
    near(convert("temperature", "fahrenheit", "celsius", 98.6), 37, 1);
  });

  it("gives back the same number when the unit does not change, and round-trips", () => {
    for (const category of UNIT_CATEGORIES) {
      for (const unit of CATEGORIES[category]) {
        near(convert(category, unit.id, unit.id, 12.5), 12.5, 9);
        near(convert(category, unit.id, DEFAULT_PAIR[category][0], convert(category, DEFAULT_PAIR[category][0], unit.id, 7.25)), 7.25, 6);
      }
    }
  });

  it("has a usable default pair in every category, and more than one unit", () => {
    for (const category of UNIT_CATEGORIES) {
      expect(CATEGORIES[category].length).toBeGreaterThan(1);
      const [from, to] = DEFAULT_PAIR[category];
      expect(unitIn(category, from).id).toBe(from);
      expect(unitIn(category, to).id).toBe(to);
      expect(from).not.toBe(to);
    }
  });

  it("falls back to the first unit for one it does not know", () => {
    expect(unitIn("length", "cubit").id).toBe("millimeter");
  });

  it("names every unit through Intl, in the user's language", () => {
    expect(unitSymbol("kilometer", "en")).toBe("km");
    expect(unitSymbol("mile", "en")).toBe("mi");
    expect(unitSymbol("celsius", "en")).toBe("°C");
    expect(unitSymbol("kilometer-per-hour", "en")).toBe("km/h");
    expect(unitSymbol("megabyte", "en")).toBe("MB");
    expect(unitName("kilometer", "en")).toBe("kilometers");
    for (const category of UNIT_CATEGORIES) {
      for (const unit of CATEGORIES[category]) {
        expect(unitSymbol(unit.id, "en")).not.toBe("");
        expect(unitName(unit.id, "de")).not.toBe("");
      }
    }
  });

  it("writes numbers the way the user reads them", () => {
    expect(formatNumber(1234.5678, "en")).toBe("1,234.57");
    expect(formatNumber(0.621371192, "en")).toBe("0.621371");
    expect(formatNumber(1234.5678, "de")).toBe("1.234,57");
    expect(formatNumber(Number.POSITIVE_INFINITY, "en")).toBe("–");
  });

  it("reads what was typed, allowing a comma for the decimal mark", () => {
    expect(parseAmount("12")).toBe(12);
    expect(parseAmount(" 1,5 ")).toBe(1.5);
    expect(parseAmount("-3.25")).toBe(-3.25);
    expect(parseAmount(".5")).toBe(0.5);
    expect(parseAmount("1e3")).toBe(1000);
    for (const bad of ["", "abc", "1.2.3", "--1", "1 2x", "Infinity", "1e999"]) expect(parseAmount(bad)).toBeNull();
  });
});

describe("colours", () => {
  it("normalises hex to six upper-case digits and expands short hex", () => {
    expect(normaliseHex("#a1b2c3")).toBe("#A1B2C3");
    expect(normaliseHex("a1b2c3")).toBe("#A1B2C3");
    expect(normaliseHex(" #abc ")).toBe("#AABBCC");
    for (const bad of ["", "#12", "#12345", "#1234567", "#ggg", "red"]) expect(normaliseHex(bad)).toBeNull();
  });

  it("reads the channels", () => {
    expect(toRgb("#FF8000")).toEqual({ r: 255, g: 128, b: 0 });
    expect(toRgb("nope")).toBeNull();
    expect(rgbText("#FF8000")).toBe("rgb(255, 128, 0)");
    expect(rgbText("nope")).toBe("");
  });

  it("measures luminance from black to white and picks readable ink", () => {
    expect(luminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(luminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
    expect(inkFor("#FFFFFF")).toBe("#000000");
    expect(inkFor("#101010")).toBe("#FFFFFF");
    expect(inkFor("#1D3C8F")).toBe("#FFFFFF");
    expect(inkFor("#E94248")).toBe("#000000");
    expect(inkFor("#E2B453")).toBe("#000000");
    expect(inkFor("nope")).toBe("#FFFFFF");
  });

  it("remembers the newest first, once each, up to a limit", () => {
    expect(remember(["#111111", "#222222"], "#222222")).toEqual(["#222222", "#111111"]);
    expect(remember([], "abc")).toEqual(["#AABBCC"]);
    expect(remember(["#111111"], "nope")).toEqual(["#111111"]);
    const many = Array.from({ length: HISTORY_SIZE + 3 }, (_, i) => `#${String(i).padStart(6, "0")}`);
    expect(many.reduce<string[]>((h, hex) => remember(h, hex), [])).toHaveLength(HISTORY_SIZE);
  });

  it("reads a saved history and ignores what is not colours", () => {
    expect(parseHistory('["#abc","nope",3,"#112233"]')).toEqual(["#AABBCC", "#112233"]);
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory("{bad")).toEqual([]);
    expect(parseHistory('{"a":1}')).toEqual([]);
  });
});

describe("emoji", () => {
  it("offers a good number in every group, each one drawn as a picture on its own", () => {
    for (const group of EMOJI_GROUPS) {
      const list = emojiOf(group);
      expect(list.length).toBeGreaterThan(10);
      expect(list.every((e) => /^\p{Emoji_Presentation}$/u.test(e))).toBe(true);
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("starts the faces with the grin", () => {
    expect(emojiOf("faces")[0]).toBe("😀");
  });

  it("keeps the newest recent emoji first, once each, up to a limit", () => {
    expect(pushRecent(["😀", "🔥"], "🔥")).toEqual(["🔥", "😀"]);
    const many = emojiOf("faces").slice(0, RECENT_SIZE + 4).reduce<string[]>((r, e) => pushRecent(r, e), []);
    expect(many).toHaveLength(RECENT_SIZE);
  });

  it("reads a saved list and ignores what is not emoji", () => {
    expect(parseRecent('["😀","a",5,"🔥"]')).toEqual(["😀", "🔥"]);
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent("{bad")).toEqual([]);
  });
});

describe("world clock", () => {
  const instant = new Date(Date.UTC(2026, 10, 20, 23, 30));

  it("lists the chosen cities with the time there and what day it is", () => {
    const rows = worldRows(["tokyo", "london", "new-york"], instant);
    const tokyo = rows.find((r) => r.city.id === "tokyo");
    expect(tokyo?.offset).toBe("UTC+9");
    expect(tokyo?.time).toMatch(/8:30|08:30/);
    expect(rows.map((r) => r.city.id)).toEqual(["tokyo", "london", "new-york"]);
  });

  it("knows a city that is a day ahead or behind this device's date", () => {
    const rows = worldRows(["tokyo", "honolulu"], new Date(2026, 10, 20, 12, 0));
    for (const row of rows) expect([-1, 0, 1]).toContain(row.dayOffset);
  });

  it("skips a city that is not in the list", () => {
    expect(worldRows(["atlantis", "paris"], instant).map((r) => r.city.id)).toEqual(["paris"]);
  });

  it("offers the cities that are not chosen, matching name or zone, accents ignored", () => {
    expect(cityChoices([], "").length).toBeGreaterThan(30);
    expect(cityChoices(["london"], "lond")).toEqual([]);
    expect(cityChoices([], "LONDON").map((c) => c.id)).toContain("london");
    expect(cityChoices([], "europe/par").map((c) => c.id)).toContain("paris");
    expect(cityChoices([], "qqqq")).toEqual([]);
  });

  it("adds a city once, stops at the limit and ignores unknown ids", () => {
    expect(addCity(["paris"], "paris")).toEqual(["paris"]);
    expect(addCity(["paris"], "tokyo")).toEqual(["paris", "tokyo"]);
    expect(addCity(["paris"], "atlantis")).toEqual(["paris"]);
    const full = ["paris", "london", "tokyo", "berlin", "madrid", "rome"];
    expect(full).toHaveLength(MAX_CITIES);
    expect(addCity(full, "cairo")).toEqual(full);
    expect(removeCity(full, "tokyo")).not.toContain("tokyo");
  });

  it("reads a saved list and drops damage, duplicates and unknown cities", () => {
    expect(parseCities('["paris","atlantis","paris","tokyo"]')).toEqual(["paris", "tokyo"]);
    expect(parseCities(null)).toEqual([]);
    expect(parseCities("{bad")).toEqual([]);
    expect(parseCities("[1,2]")).toEqual([]);
  });
});

describe("network", () => {
  const s = (at: number, down: number, up = 0): RateSample => ({ at, down, up });

  it("writes a rate in the largest sensible unit", () => {
    expect(formatRate(0, "en")).toBe("0 byte/s");
    expect(formatRate(512, "en")).toBe("512 byte/s");
    expect(formatRate(1500, "en")).toBe("1.5 kB/s");
    expect(formatRate(4_200_000, "en")).toBe("4.2 MB/s");
    expect(formatRate(312_000, "en")).toBe("312 kB/s");
    expect(formatRate(2.5e9, "en")).toBe("2.5 GB/s");
  });

  it("treats a bad number as nothing", () => {
    expect(formatRate(Number.NaN, "en")).toBe("0 byte/s");
    expect(formatRate(-5, "en")).toBe("0 byte/s");
  });

  it("keeps a minute of samples, with the newest one before the edge", () => {
    let history: readonly RateSample[] = [];
    for (let at = 0; at <= 100_000; at += 10_000) history = appendRate(history, s(at, at));
    expect(history[0]?.at).toBe(40_000);
    expect(appendRate(history, s(100_000, 5))).toBe(history);
    expect(appendRate(history, s(1, 5))).toBe(history);
  });

  it("scales a graph to the busiest second, but never below a floor", () => {
    expect(scaleOf([])).toBe(MIN_SCALE_BYTES);
    expect(scaleOf([s(0, 100, 50)])).toBe(MIN_SCALE_BYTES);
    expect(scaleOf([s(0, 2_000_000, 50), s(1, 10, 3_000_000)])).toBe(3_000_000);
  });

  it("lights dots in proportion, a flat line for a quiet stretch and nothing before the first sample", () => {
    const history = [s(30_000, 500_000), s(60_000, 1_000_000)];
    const levels = rateLevels(history, "down", 1_000_000, 60_000, 6, 10);
    expect(levels).toEqual([0, 0, 5, 5, 5, 10]);
    expect(rateLevels(history, "up", 1_000_000, 60_000, 6, 10)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe("saved settings", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("survives a page whose storage refuses to read or write", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    const { useTools } = await import("./toolsStore");
    useTools.getState().pickColour("#abc");
    expect(useTools.getState().colours).toEqual(["#AABBCC"]);
  });
});
