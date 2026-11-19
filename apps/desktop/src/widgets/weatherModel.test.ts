import { describe, expect, it } from "vitest";
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
    expect(conditionIcon(0, true)).toBe("sun");
    expect(conditionIcon(0, false)).toBe("moon");
    expect(conditionIcon(1, true)).toBe("cloud-sun");
    expect(conditionIcon(1, false)).toBe("cloud");
    expect(conditionIcon(61, true)).toBe("rain");
    expect(conditionIcon(80, false)).toBe("rain");
    expect(conditionIcon(75, true)).toBe("snow");
    expect(conditionIcon(95, true)).toBe("storm");
    expect(conditionIcon(48, true)).toBe("fog");
  });

  it("places now between today's low and high", () => {
    expect(rangePosition(20, 10, 30)).toBe(0.5);
    expect(rangePosition(5, 10, 30)).toBe(0);
    expect(rangePosition(35, 10, 30)).toBe(1);
    expect(rangePosition(20, 20, 20)).toBe(0.5);
  });
});
