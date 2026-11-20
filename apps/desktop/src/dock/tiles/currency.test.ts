import { describe, expect, it } from "vitest";
import { convertMoney, currencies, currencyName, DEFAULT_CURRENCY, formatMoney, parseCurrency } from "./currency";
import type { RatesView } from "./ui-types";

const rates: RatesView = { base: "EUR", publishedAt: Date.parse("2026-11-20T15:00:00Z"), rates: { USD: 1.1, INR: 92.5, JPY: 160 } };

describe("currency conversion", () => {
  it("converts from and to the base", () => {
    expect(convertMoney(rates, "EUR", "USD", 10)).toBeCloseTo(11);
    expect(convertMoney(rates, "USD", "EUR", 11)).toBeCloseTo(10);
  });

  it("converts across two currencies through the base", () => {
    expect(convertMoney(rates, "USD", "INR", 1.1)).toBeCloseTo(92.5);
  });

  it("has no answer for a currency without a rate", () => {
    expect(convertMoney(rates, "EUR", "XYZ", 1)).toBeNull();
    expect(convertMoney({ ...rates, rates: { USD: 0 } }, "USD", "EUR", 1)).toBeNull();
  });

  it("lists the base first, then the rest by code", () => {
    expect(currencies(rates)).toEqual(["EUR", "INR", "JPY", "USD"]);
  });

  it("repairs a saved setup", () => {
    expect(parseCurrency(JSON.stringify({ from: "USD", to: "INR", amount: "12,5" }))).toEqual({ from: "USD", to: "INR", amount: "12,5" });
    expect(parseCurrency(JSON.stringify({ from: "usd", to: 4 }))).toEqual(DEFAULT_CURRENCY);
    expect(parseCurrency("nope")).toEqual(DEFAULT_CURRENCY);
  });

  it("formats in the currency's own decimals, and names it", () => {
    expect(formatMoney(1234.5, "USD", "en-US")).toBe("$1,234.50");
    expect(formatMoney(1234.5, "JPY", "en-US")).toBe("¥1,235");
    expect(currencyName("USD")).toMatch(/dollar/i);
  });
});
