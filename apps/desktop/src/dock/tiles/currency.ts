import type { RatesView } from "./ui-types";

/**
 * Currency conversion over the reference rates the core keeps (the European Central Bank's daily rates, cached on
 * disk so the tile works offline with the last ones it saw). Each rate is units of the currency per one unit of the
 * base, and the base itself is 1.
 */
export const DEFAULT_CURRENCY_PAIR = ["EUR", "USD"] as const;

export interface CurrencySetup {
  readonly from: string;
  readonly to: string;
  /** What was typed, so "1,5" stays as typed. */
  readonly amount: string;
}

export const DEFAULT_CURRENCY: CurrencySetup = { from: DEFAULT_CURRENCY_PAIR[0], to: DEFAULT_CURRENCY_PAIR[1], amount: "1" };

const rateOf = (rates: RatesView, code: string): number | null => (code === rates.base ? 1 : (rates.rates[code] ?? null));

/** The currencies that can be converted, the base first, then by code. */
export function currencies(rates: RatesView): string[] {
  return [rates.base, ...Object.keys(rates.rates).filter((c) => c !== rates.base).sort()];
}

/** `amount` of `from` in `to`, or null when either has no rate. */
export function convertMoney(rates: RatesView, from: string, to: string, amount: number): number | null {
  const a = rateOf(rates, from);
  const b = rateOf(rates, to);
  if (a === null || b === null || a <= 0) return null;
  return (amount / a) * b;
}

/** A saved setup, repaired: a code that is not three capital letters falls back to the default pair. */
export function parseCurrency(raw: string | null): CurrencySetup {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (value === null || typeof value !== "object") return DEFAULT_CURRENCY;
    const { from, to, amount } = value as Record<string, unknown>;
    const code = (c: unknown, fallback: string): string => (typeof c === "string" && /^[A-Z]{3}$/.test(c) ? c : fallback);
    return { from: code(from, DEFAULT_CURRENCY.from), to: code(to, DEFAULT_CURRENCY.to), amount: typeof amount === "string" ? amount.slice(0, 24) : DEFAULT_CURRENCY.amount };
  } catch {
    return DEFAULT_CURRENCY;
  }
}

const moneyFormats = new Map<string, Intl.NumberFormat>();

/** "$1,083.20", in the user's format and the currency's own number of decimals. */
export function formatMoney(value: number, code: string, locale?: string): string {
  const key = `${locale ?? ""}|${code}`;
  let format = moneyFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, { style: "currency", currency: code, currencyDisplay: "narrowSymbol" });
    moneyFormats.set(key, format);
  }
  return format.format(value);
}

let names: Intl.DisplayNames | null = null;

/** "US Dollar", from the platform, or the code itself where it has no name. */
export function currencyName(code: string): string {
  names ??= new Intl.DisplayNames(undefined, { type: "currency" });
  return names.of(code) ?? code;
}
