import { describe, expect, it } from "vitest";
import { DOT_ICON_NAMES } from "../design-system/icons";
import { conditionIcon, conditionLabel, rangePosition } from "./weatherModel";

describe("weather", () => {
  it("names the WMO codes Open-Meteo sends", () => {
    expect(conditionLabel(0)).toBe("Clear");
    expect(conditionLabel(2)).toBe("Partly cloudy");
    expect(conditionLabel(3)).toBe("Overcast");
    expect(conditionLabel(45)).toBe("Fog");
    expect(conditionLabel(55)).toBe("Drizzle");
    expect(conditionLabel(63)).toBe("Rain");
    expect(conditionLabel(73)).toBe("Snow");
    expect(conditionLabel(81)).toBe("Showers");
    expect(conditionLabel(86)).toBe("Snow showers");
    expect(conditionLabel(96)).toBe("Thunderstorm");
    expect(conditionLabel(42)).toBe("Unknown");
  });

  it("chooses an icon that fits the sky and the time of day", () => {
    expect(conditionIcon(0, true)).toBe("clear-day");
    expect(conditionIcon(0, false)).toBe("clear-night");
    expect(conditionIcon(1, true)).toBe("partly-day");
    expect(conditionIcon(2, false)).toBe("partly-night");
    expect(conditionIcon(3, true)).toBe("cloudy");
    expect(conditionIcon(48, true)).toBe("fog");
    expect(conditionIcon(53, true)).toBe("drizzle");
    expect(conditionIcon(61, true)).toBe("rain");
    expect(conditionIcon(67, false)).toBe("rain");
    expect(conditionIcon(75, true)).toBe("snow");
    expect(conditionIcon(86, false)).toBe("snow");
    expect(conditionIcon(81, true)).toBe("showers-day");
    expect(conditionIcon(81, false)).toBe("showers-night");
    expect(conditionIcon(95, true)).toBe("thunder");
    expect(conditionIcon(99, false)).toBe("thunder");
  });

  it("has a drawn pictogram for every code the provider can send", () => {
    for (let code = 0; code <= 99; code++) {
      for (const day of [true, false]) expect(DOT_ICON_NAMES).toContain(conditionIcon(code, day));
    }
  });

  it("places now between today's low and high", () => {
    expect(rangePosition(20, 10, 30)).toBe(0.5);
    expect(rangePosition(5, 10, 30)).toBe(0);
    expect(rangePosition(35, 10, 30)).toBe(1);
    expect(rangePosition(20, 20, 20)).toBe(0.5);
  });
});
