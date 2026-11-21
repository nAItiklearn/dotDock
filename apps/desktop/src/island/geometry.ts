import { SCENE_CELL, SCENE_ROWS } from "./scene/layout";
import type { IslandSettings, SessionView } from "./protocol";

/**
 * Island layout, in px at scale 1. Every on-screen size derives from these named numbers:
 * the TypeScript side sets them as CSS custom properties, the stylesheet never repeats them.
 */
export const BASE = {
  tinyWidth: 44,
  tinyHeight: 12,
  islandWidth: 328,
  padding: 12,
  /** Diameter of the state orb; one lattice cell is a seventh of it. */
  orb: 20,
  stateRow: 22,
  subtitleRow: 14,
  subtitleGap: 4,
  sceneGap: 6,
  sceneBottom: 8,
  /** Visible strip left on screen while the island is moved aside. */
  sliver: 6,
  /** Room kept below the plate for its shadow so it is never clipped by the window. */
  shadowRoom: 28,
} as const;

/** Height of the scene strip in px at scale 1. */
export const SCENE_HEIGHT = SCENE_ROWS * SCENE_CELL;

export type Mode = "hidden" | "tiny" | "island";

export interface Rows {
  /** The dim line above the state row. */
  readonly subtitle: boolean;
  /** The beetle and landscape strip along the bottom edge. */
  readonly scene: boolean;
}

/** Which of the looks the island has right now. */
export function modeFor(settings: IslandSettings, session: SessionView | null): Mode {
  if (!session) return settings.idle === "hidden" ? "hidden" : "tiny";
  return "island";
}

export interface Size {
  readonly w: number;
  readonly h: number;
}

/** Resting position of every row inside the island, from the top edge of the plate, plus the plate's size. */
export interface Layout extends Size {
  readonly subtitleTop: number;
  readonly rowTop: number;
  readonly sceneTop: number;
}

/** Lays the rows out in px at the given scale. Width is fixed so changing text never moves anything sideways. */
export function layoutFor(rows: Rows, scale: number): Layout {
  const subtitle = rows.subtitle ? BASE.subtitleRow + BASE.subtitleGap : 0;
  const rowTop = BASE.padding + subtitle;
  const sceneTop = rowTop + BASE.stateRow + BASE.sceneGap;
  const bottom = rows.scene ? sceneTop + SCENE_HEIGHT + BASE.sceneBottom : rowTop + BASE.stateRow + BASE.padding;
  return {
    w: BASE.islandWidth * scale,
    h: bottom * scale,
    subtitleTop: BASE.padding * scale,
    rowTop: rowTop * scale,
    sceneTop: sceneTop * scale,
  };
}

/** Plate size for a mode. Off, hidden and tiny share one size so nothing jumps between them. */
export function plateSize(mode: Mode, rows: Rows, scale: number): Size {
  if (mode === "island") {
    const { w, h } = layoutFor(rows, scale);
    return { w, h };
  }
  return { w: BASE.tinyWidth * scale, h: BASE.tinyHeight * scale };
}
