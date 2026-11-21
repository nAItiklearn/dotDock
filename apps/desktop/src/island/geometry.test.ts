import { describe, expect, it } from "vitest";
import { BASE, SCENE_HEIGHT, layoutFor, modeFor, plateSize } from "./geometry";
import { DEFAULT_SETTINGS, WINDOW_SIZE, type IslandSettings, type SessionView } from "./protocol";

const SESSION: SessionView = {
  id: "s",
  agent: "claude",
  agentLabel: "Claude Code",
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
const ALL = { subtitle: true, scene: true } as const;
const NONE = { subtitle: false, scene: false } as const;

describe("modeFor", () => {
  it("idles as a tiny pill or hides, as the setting says", () => {
    expect(modeFor(settings({ idle: "tiny" }), null)).toBe("tiny");
    expect(modeFor(settings({ idle: "hidden" }), null)).toBe("hidden");
  });

  it("grows into the island whenever a session is shown", () => {
    expect(modeFor(DEFAULT_SETTINGS, SESSION)).toBe("island");
    expect(modeFor(settings({ showDetail: false, showTokens: false, showScene: false }), SESSION)).toBe("island");
  });
});

describe("defaults", () => {
  it("keep the island quiet: no timer and no project unless asked for", () => {
    expect(DEFAULT_SETTINGS.showElapsed).toBe(false);
    expect(DEFAULT_SETTINGS.showProject).toBe(false);
    expect(DEFAULT_SETTINGS.showScene).toBe(true);
  });
});

describe("layoutFor", () => {
  it("stacks the state row, the gap and the scene strip when there is no subtitle", () => {
    const layout = layoutFor({ subtitle: false, scene: true }, 1);
    expect(layout.rowTop).toBe(BASE.padding);
    expect(layout.sceneTop).toBe(BASE.padding + BASE.stateRow + BASE.sceneGap);
    expect(layout.h).toBe(layout.sceneTop + SCENE_HEIGHT + BASE.sceneBottom);
  });

  it("pushes the rows below the subtitle by exactly the subtitle row and its gap", () => {
    const without = layoutFor({ subtitle: false, scene: true }, 1);
    const withLine = layoutFor(ALL, 1);
    const extra = BASE.subtitleRow + BASE.subtitleGap;
    expect(withLine.rowTop - without.rowTop).toBe(extra);
    expect(withLine.sceneTop - without.sceneTop).toBe(extra);
    expect(withLine.h - without.h).toBe(extra);
    expect(withLine.subtitleTop).toBe(without.subtitleTop);
  });

  it("is shorter without the scene and closes the island with the same padding as the top", () => {
    const layout = layoutFor({ subtitle: false, scene: false }, 1);
    expect(layout.h).toBe(BASE.padding + BASE.stateRow + BASE.padding);
    expect(layoutFor(ALL, 1).h).toBeGreaterThan(layoutFor({ subtitle: true, scene: false }, 1).h);
  });

  it("keeps the width fixed whatever the rows, and scales every measure together", () => {
    expect(layoutFor(NONE, 1).w).toBe(BASE.islandWidth);
    expect(layoutFor(ALL, 1).w).toBe(BASE.islandWidth);
    const big = layoutFor(ALL, 1.4);
    const base = layoutFor(ALL, 1);
    for (const key of ["w", "h", "subtitleTop", "rowTop", "sceneTop"] as const) expect(big[key]).toBeCloseTo(base[key] * 1.4);
  });
});

describe("plateSize", () => {
  it("sizes the tiny pill and keeps hidden at the same size so nothing jumps", () => {
    const tiny = plateSize("tiny", ALL, 1);
    expect(tiny).toEqual({ w: BASE.tinyWidth, h: BASE.tinyHeight });
    expect(plateSize("hidden", ALL, 1)).toEqual(tiny);
  });

  it("uses the full layout for the island", () => {
    const layout = layoutFor(ALL, 1);
    expect(plateSize("island", ALL, 1)).toEqual({ w: layout.w, h: layout.h });
  });
});

describe("fit inside the window", () => {
  it("leaves shadow room beside the widest island", () => {
    expect(layoutFor(ALL, 1.4).w + 2 * BASE.shadowRoom).toBeLessThanOrEqual(WINDOW_SIZE.width);
  });

  it("fits the tallest island at the largest size and the largest top offset, shadow included", () => {
    const tallest = layoutFor(ALL, 1.4).h;
    expect(64 + tallest + BASE.shadowRoom * 1.4).toBeLessThanOrEqual(WINDOW_SIZE.height);
  });
});
