import { describe, expect, it } from "vitest";
import { parseShadow, plateRadius, settledAmount, squashedChrome } from "./squash";

describe("parseShadow", () => {
  it("reads the three theme shadows", () => {
    expect(parseShadow("0 12px 32px rgba(0, 0, 0, 0.35)")).toEqual({ x: 0, y: 12, blur: 32, spread: 0, color: "rgba(0, 0, 0, 0.35)" });
    expect(parseShadow("0 10px 28px rgba(17, 17, 17, 0.12)")?.blur).toBe(28);
  });

  it("reads an explicit spread", () => {
    expect(parseShadow("1px 2px 3px 4px #000")).toEqual({ x: 1, y: 2, blur: 3, spread: 4, color: "#000" });
  });

  it("refuses stacked and inset shadows", () => {
    expect(parseShadow("0 1px 2px red, 0 3px 4px blue")).toBeNull();
    expect(parseShadow("inset 0 1px 2px red")).toBeNull();
    expect(parseShadow("none")).toBeNull();
  });
});

describe("squashedChrome", () => {
  const shadow = parseShadow("0 12px 32px rgba(0, 0, 0, 0.35)");

  it("leaves everything as designed when the plate is not squashed", () => {
    const chrome = squashedChrome(1, 1, 20, 1, shadow);
    expect(chrome.borderRadius).toBe("20px / 20px");
    expect(chrome.boxShadow).toBe("0 0 0 1px var(--border), 0px 12px 32px 0px rgba(0, 0, 0, 0.35)");
  });

  it("grows radius, hairline and shadow inversely to the squash", () => {
    const chrome = squashedChrome(0.5, 0.25, 20, 1, shadow);
    expect(chrome.borderRadius).toBe("40px / 80px");
    expect(chrome.boxShadow).toContain("0 0 0 2.83px var(--border)");
    expect(chrome.boxShadow).toContain("48px");
  });

  it("survives a fully squashed plate and a missing shadow token", () => {
    expect(squashedChrome(0, 0, 10, 1, null).boxShadow).toBe("0 0 0 1000px var(--border)");
  });
});

describe("settledAmount and plateRadius", () => {
  it("fades the texture in only near the final size", () => {
    expect(settledAmount(0.3, 0.3)).toBe(0);
    expect(settledAmount(1, 0.9)).toBeCloseTo(0.333, 2);
    expect(settledAmount(1, 1)).toBe(1);
  });

  it("makes pill modes fully round and the card use the token", () => {
    expect(plateRadius(true, 12, 20, 1)).toBe(6);
    expect(plateRadius(false, 108, 20, 1.5)).toBe(30);
  });
});
