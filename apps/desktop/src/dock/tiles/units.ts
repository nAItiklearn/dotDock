/**
 * Unit conversion, with the standard definitions: metre, gram, litre and their customary neighbours (the international
 * foot, avoirdupois pound, US gallon), metre per second, the hectare, and decimal bytes. Temperature is the one
 * conversion that is not a ratio. Names and symbols come from `Intl`, so they follow the user's language.
 */
export type UnitCategory = "length" | "mass" | "volume" | "temperature" | "speed" | "area" | "data";

export interface Unit {
  /** An ECMA-402 sanctioned unit id, which `Intl.NumberFormat` can name. */
  readonly id: string;
  /** Converts a value of this unit to the category's base unit. */
  readonly toBase: (value: number) => number;
  readonly fromBase: (base: number) => number;
}

const linear = (id: string, perBase: number): Unit => ({ id, toBase: (v) => v * perBase, fromBase: (b) => b / perBase });

/** Bases: metre, gram, litre, degree Celsius, metre per second, square metre, byte. */
export const CATEGORIES: Readonly<Record<UnitCategory, readonly Unit[]>> = {
  length: [
    linear("millimeter", 0.001),
    linear("centimeter", 0.01),
    linear("meter", 1),
    linear("kilometer", 1000),
    linear("inch", 0.0254),
    linear("foot", 0.3048),
    linear("yard", 0.9144),
    linear("mile", 1609.344),
  ],
  mass: [linear("gram", 1), linear("kilogram", 1000), linear("ounce", 28.349523125), linear("pound", 453.59237), linear("stone", 6350.29318)],
  volume: [linear("milliliter", 0.001), linear("liter", 1), linear("fluid-ounce", 0.0295735295625), linear("gallon", 3.785411784)],
  temperature: [
    { id: "celsius", toBase: (v) => v, fromBase: (b) => b },
    { id: "fahrenheit", toBase: (v) => ((v - 32) * 5) / 9, fromBase: (b) => (b * 9) / 5 + 32 },
  ],
  speed: [linear("kilometer-per-hour", 1 / 3.6), linear("meter-per-second", 1), linear("mile-per-hour", 0.44704)],
  area: [linear("hectare", 10_000), linear("acre", 4046.8564224)],
  data: [linear("byte", 1), linear("kilobyte", 1e3), linear("megabyte", 1e6), linear("gigabyte", 1e9), linear("terabyte", 1e12)],
};

export const UNIT_CATEGORIES = Object.keys(CATEGORIES) as readonly UnitCategory[];

export const DEFAULT_PAIR: Readonly<Record<UnitCategory, readonly [string, string]>> = {
  length: ["kilometer", "mile"],
  mass: ["kilogram", "pound"],
  volume: ["liter", "gallon"],
  temperature: ["celsius", "fahrenheit"],
  speed: ["kilometer-per-hour", "mile-per-hour"],
  area: ["hectare", "acre"],
  data: ["gigabyte", "megabyte"],
};

export function unitIn(category: UnitCategory, id: string): Unit {
  const list = CATEGORIES[category];
  const found = list.find((u) => u.id === id);
  const fallback = list[0];
  if (found) return found;
  if (!fallback) throw new Error(`no units in ${category}`);
  return fallback;
}

/** `value` of unit `from` written in unit `to`, both in `category`. */
export function convert(category: UnitCategory, from: string, to: string, value: number): number {
  return unitIn(category, to).fromBase(unitIn(category, from).toBase(value));
}

/** Significant digits shown in a result: enough to be useful, few enough to read at a glance. */
const SIGNIFICANT_DIGITS = 6;

export function formatNumber(value: number, locale?: string): string {
  if (!Number.isFinite(value)) return "–";
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: SIGNIFICANT_DIGITS }).format(value);
}

/** The unit's short symbol in the user's language: "km", "mi", "°C". */
export function unitSymbol(id: string, locale?: string): string {
  const parts = new Intl.NumberFormat(locale, { style: "unit", unit: id, unitDisplay: "short" }).formatToParts(1);
  return parts.find((p) => p.type === "unit")?.value ?? id;
}

/** The unit's full name in the user's language: "kilometres". */
export function unitName(id: string, locale?: string): string {
  const parts = new Intl.NumberFormat(locale, { style: "unit", unit: id, unitDisplay: "long" }).formatToParts(2);
  return parts.find((p) => p.type === "unit")?.value ?? id;
}

/** Reads what the user typed as a number: a comma may be the decimal mark. Null for anything else. */
export function parseAmount(text: string): number | null {
  const cleaned = text.trim().replace(/\s/g, "").replace(",", ".");
  if (cleaned === "" || !/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}
