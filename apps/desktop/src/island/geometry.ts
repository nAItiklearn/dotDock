import { WINDOW_SIZE, type IslandSettings, type SessionView } from "./protocol";

/**
 * Island layout, in px at scale 1. Every on-screen size derives from these named numbers:
 * the TypeScript side sets them as CSS custom properties, the stylesheet never repeats them.
 */
export const BASE = {
  tinyWidth: 44,
  tinyHeight: 12,
  compactWidth: 276,
  islandWidth: 328,
  padding: 12,
  /** Lattice cell pitch of the state icon; the icon is 7 cells square. */
  cell: 5,
  detailRow: 14,
  footerRow: 14,
  /** Height of the dot-matrix elapsed timer inside the footer row. */
  digitHeight: 11,
  rowGap: 7,
  /** Visible strip left on screen while the island is moved aside. */
  sliver: 6,
  /** Room kept below the plate for its shadow so it is never clipped by the window. */
  shadowRoom: 28,
} as const;

export const ICON_CELLS = 7;

export type Mode = "off" | "hidden" | "tiny" | "compact" | "island";

export interface Rows {
  readonly detail: boolean;
  readonly footer: boolean;
}

export function rowsFor(settings: IslandSettings): Rows {
  return { detail: settings.showDetail, footer: settings.showTokens || settings.showElapsed || settings.showProject };
}

/** Which of the four looks the island has right now. */
export function modeFor(settings: IslandSettings, session: SessionView | null): Mode {
  if (!settings.enabled) return "off";
  if (!session) return settings.idle === "hidden" ? "hidden" : "tiny";
  const rows = rowsFor(settings);
  return rows.detail || rows.footer ? "island" : "compact";
}

export interface Size {
  readonly w: number;
  readonly h: number;
}

/** Plate size in px at the given scale. Width is fixed per mode so changing text never moves anything. */
export function plateSize(mode: Mode, rows: Rows, scale: number): Size {
  if (mode === "off" || mode === "hidden" || mode === "tiny") {
    return { w: BASE.tinyWidth * scale, h: BASE.tinyHeight * scale };
  }
  const header = BASE.cell * ICON_CELLS;
  let h = BASE.padding * 2 + header;
  if (mode === "island") {
    if (rows.detail) h += BASE.rowGap + BASE.detailRow;
    if (rows.footer) h += BASE.rowGap + BASE.footerRow;
  }
  return { w: (mode === "island" ? BASE.islandWidth : BASE.compactWidth) * scale, h: h * scale };
}

/**
 * The window is fixed in size, so the distance from the top edge is limited by what still fits
 * beneath the plate. At the largest size this can be less than the setting asks for.
 */
export function effectiveTopOffset(topOffset: number, plateHeight: number, scale: number): number {
  const room = WINDOW_SIZE.height - plateHeight - BASE.shadowRoom * scale;
  return Math.max(0, Math.min(topOffset, room));
}
