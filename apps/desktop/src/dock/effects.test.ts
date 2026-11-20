import { describe, expect, it } from "vitest";
import { chooseEffects, LITE_MAX_CORES, LITE_MAX_MEMORY_GB, parseChoice, type Capabilities } from "./effects";

const strong: Capabilities = { cores: 12, memoryGb: 8, reducedTransparency: false, softwareRendering: false };

describe("chooseEffects", () => {
  it("uses full effects on a capable machine", () => {
    expect(chooseEffects("auto", strong)).toBe("full");
  });

  it("falls back to lite for every low-spec signal", () => {
    expect(chooseEffects("auto", { ...strong, cores: LITE_MAX_CORES })).toBe("lite");
    expect(chooseEffects("auto", { ...strong, memoryGb: LITE_MAX_MEMORY_GB })).toBe("lite");
    expect(chooseEffects("auto", { ...strong, reducedTransparency: true })).toBe("lite");
    expect(chooseEffects("auto", { ...strong, softwareRendering: true })).toBe("lite");
  });

  it("does not guess from numbers the browser would not tell", () => {
    expect(chooseEffects("auto", { ...strong, cores: null, memoryGb: null })).toBe("full");
  });

  it("obeys an explicit choice either way", () => {
    expect(chooseEffects("lite", strong)).toBe("lite");
    expect(chooseEffects("full", { ...strong, cores: 2, softwareRendering: true })).toBe("full");
  });
});

describe("parseChoice", () => {
  it("accepts the two tiers and treats anything else as automatic", () => {
    expect(parseChoice("full")).toBe("full");
    expect(parseChoice("lite")).toBe("lite");
    expect(parseChoice("ultra")).toBe("auto");
    expect(parseChoice(null)).toBe("auto");
  });
});
