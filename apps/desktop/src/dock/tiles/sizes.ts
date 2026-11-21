import type { TileId } from "../model";

/**
 * How long a tile is on the dock. A wide tile shows a mark and words; a compact one only the mark, the size every tile
 * already takes on a vertical dock. Tiles that are only a mark have one size.
 */
export type TileSize = "regular" | "compact";

export const TILE_SIZES_KEY = "dotdock.dock.tileSizes";

export type TileSizes = Readonly<Record<string, TileSize>>;

/** Tiles drawn as a mark with words beside it: the only ones that have a shorter form. */
export const RESIZABLE: readonly TileId[] = ["agenda", "meeting", "focus", "stopwatch", "reminders", "progress", "contacts", "notes", "convert", "world", "network", "sun", "wind", "currency", "search", "history", "memo"];

export const canResize = (id: TileId): boolean => RESIZABLE.includes(id);

export const sizeOf = (sizes: TileSizes | undefined, id: TileId): TileSize => (canResize(id) && sizes?.[id] === "compact" ? "compact" : "regular");

/** Reads the saved sizes, keeping only well-formed entries. */
export function parseSizes(raw: string | null): TileSizes {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, size]) => size === "compact" || size === "regular")) as TileSizes;
  } catch {
    return {};
  }
}

export function readTileSizes(): TileSizes {
  try {
    return parseSizes(localStorage.getItem(TILE_SIZES_KEY));
  } catch {
    return {};
  }
}

export function saveTileSizes(sizes: TileSizes): void {
  try {
    localStorage.setItem(TILE_SIZES_KEY, JSON.stringify(sizes));
  } catch {
    // Without storage the sizes last until the window closes.
  }
}

/** The sizes with one tile changed. Regular is the default, so it is not stored. */
export function withSize(sizes: TileSizes, id: TileId, size: TileSize): TileSizes {
  const { [id]: _removed, ...rest } = sizes;
  return size === "compact" ? { ...rest, [id]: size } : rest;
}
