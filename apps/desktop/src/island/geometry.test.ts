import { describe, expect, it } from "vitest";
import { BASE, ICON_CELLS, effectiveTopOffset, modeFor, plateSize, rowsFor } from "./geometry";
import { DEFAULT_SETTINGS, WINDOW_SIZE, type IslandSettings, type SessionView } from "./protocol";

const SESSION: SessionView = {
  id: "s",
  agent: "claude",
  phase: "thinking",
  tool: null,
  detail: null,
  project: "p",
  title: null,
  summary: null,
  problem: null,
  tokensOut: 0,
  contextTokens: null,
  turnStartedAt: null,
  updatedAt: 0,
  collapseAt: null,
};

const settings = (patch: Partial<IslandSettings>): IslandSettings => ({ ...DEFAULT_SETTINGS, ...patch });
const NO_ROWS = { showDetail: false, showTokens: false, showElapsed: false, showProject: false } as const;

describe("modeFor", () => {
  it("is off when the island is disabled, even mid-task", () => {
    expect(modeFor(settings({ enabled: false }), SESSION)).toBe("off");
    expect(modeFor(settings({ enabled: false }), null)).toBe("off");
  });

  it("idles as a tiny pill or hides, as the setting says", () => {
    expect(modeFor(settings({ idle: "tiny" }), null)).toBe("tiny");
    expect(modeFor(settings({ idle: "hidden" }), null)).toBe("hidden");
  });

  it("grows into the island, or a compact pill when every detail is off", () => {
    expect(modeFor(DEFAULT_SETTINGS, SESSION)).toBe("island");
    expect(modeFor(settings({ ...NO_ROWS, showProject: true }), SESSION)).toBe("island");
    expect(modeFor(settings(NO_ROWS), SESSION)).toBe("compact");
  });
});

describe("rowsFor", () => {
  it("shows the footer when any one of its three parts is on", () => {
    expect(rowsFor(settings({ ...NO_ROWS, showElapsed: true })).footer).toBe(true);
    expect(rowsFor(settings(NO_ROWS)).footer).toBe(false);
    expect(rowsFor(settings({ ...NO_ROWS, showDetail: true })).detail).toBe(true);
  });
});

describe("plateSize", () => {
  const all = { detail: true, footer: true };

  it("sizes the tiny pill and keeps hidden and off at the same size so nothing jumps", () => {
    const tiny = plateSize("tiny", all, 1);
    expect(tiny).toEqual({ w: BASE.tinyWidth, h: BASE.tinyHeight });
    expect(plateSize("hidden", all, 1)).toEqual(tiny);
    expect(plateSize("off", all, 1)).toEqual(tiny);
  });

  it("adds a row for each enabled part of the island", () => {
    const header = BASE.padding * 2 + BASE.cell * ICON_CELLS;
    expect(plateSize("island", { detail: false, footer: false }, 1).h).toBe(header);
    expect(plateSize("island", { detail: true, footer: false }, 1).h).toBe(header + BASE.rowGap + BASE.detailRow);
    expect(plateSize("island", all, 1).h).toBe(header + 2 * BASE.rowGap + BASE.detailRow + BASE.footerRow);
    expect(plateSize("island", all, 1).w).toBe(BASE.islandWidth);
  });

  it("keeps the compact pill narrower than the island and ignores rows", () => {
    expect(plateSize("compact", all, 1).w).toBe(BASE.compactWidth);
    expect(plateSize("compact", all, 1).w).toBeLessThan(BASE.islandWidth);
    expect(plateSize("compact", all, 1).h).toBe(BASE.padding * 2 + BASE.cell * ICON_CELLS);
  });

  it("scales both dimensions", () => {
    const base = plateSize("island", all, 1);
    const big = plateSize("island", all, 1.4);
    expect(big.w).toBeCloseTo(base.w * 1.4);
    expect(big.h).toBeCloseTo(base.h * 1.4);
  });

  it("leaves shadow room on both sides of the largest island inside the window", () => {
    expect(plateSize("island", all, 1.4).w + 2 * 28).toBeLessThanOrEqual(WINDOW_SIZE.width);
  });
});

describe("effectiveTopOffset", () => {
  const all = { detail: true, footer: true };

  it("honours the setting while the island fits beneath it", () => {
    expect(effectiveTopOffset(10, plateSize("island", all, 1).h, 1)).toBe(10);
    expect(effectiveTopOffset(64, plateSize("island", all, 1).h, 1)).toBe(64);
  });

  it("pulls the island up at the largest size so the shadow is not cut off", () => {
    const h = plateSize("island", all, 1.4).h;
    const top = effectiveTopOffset(64, h, 1.4);
    expect(top).toBeLessThan(64);
    expect(top + h + BASE.shadowRoom * 1.4).toBeLessThanOrEqual(WINDOW_SIZE.height + 1e-9);
  });

  it("never goes negative", () => {
    expect(effectiveTopOffset(10, WINDOW_SIZE.height, 1.4)).toBe(0);
  });
});
