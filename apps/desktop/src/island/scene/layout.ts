import type { Tone } from "../icons/frames";

/**
 * The scene is a dot lattice: the beetle and the landscape share it, so everything lines up cell for cell.
 * Row 0 is the top. The beetle stands with its feet on GROUND_ROW; the ground line is one row below.
 */
export const SCENE_COLS = 152;
export const SCENE_ROWS = 14;
/** Pitch of one lattice cell in CSS px at scale 1. */
export const SCENE_CELL = 2;
export const GROUND_ROW = 12;

/** Width of the beetle's sprite box in cells, facing either way. Poses may reach a little outside it. */
export const SPRITE_WIDTH = 12;
/** Row of the sprite where its feet rest. */
export const SPRITE_FEET = 7;

/** Where the beetle may walk, in lattice columns of the sprite's left edge. */
export const WALK_MIN = 8;
export const WALK_MAX = SCENE_COLS - SPRITE_WIDTH - 8;

/** Receives every lit cell of a frame: lattice column and row, brightness 0..1 and colour role. */
export type Emit = (c: number, r: number, v: number, tone: Tone) => void;
