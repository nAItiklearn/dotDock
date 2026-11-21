/**
 * The living scenes (components/LiveScene.astro): which pieces of tools/site-art/siteart/live.py each scene stacks,
 * back to front, how each one moves, and the sprites that fly or swim over it. The geometry the motion depends on
 * (stage sizes, the pivots of the horse's head and tail and of the octopus, the dragonfly's wing root) comes from
 * src/data/live-scenes.json, which tools/site-art/live_export.py writes from the same code that draws the art.
 */
import geometry from "../data/live-scenes.json" with { type: "json" };
import type { ArtName } from "./art";

export type SceneName = "paddock" | "pond" | "reef" | "meadow";

/** How a layer moves (styles/live.css). Every motion is a transform or an opacity. */
export type Motion = "still" | "sway" | "sway-late" | "bob" | "bob-late" | "twinkle" | "twinkle-late" | "graze" | "swish" | "breathe" | "curl";

/** The paths a sprite travels (styles/live.css) and how it beats its wings or fins. */
export type Path = "hover" | "dart" | "loop" | "drift" | "swim-left" | "swim-right" | "swim-far";
export type Beat = "wings" | "dragonfly" | "fins";

export interface SceneLayer {
  piece: ArtName;
  motion: Motion;
  /** The key of the pivot in live-scenes.json this layer turns about. */
  pivot?: keyof (typeof geometry.pivots)["wide"];
}
export interface SceneSprite {
  piece: ArtName;
  path: Path;
  beat: Beat;
  /** Where on the stage the sprite starts, as shares of its width and height. */
  x: number;
  y: number;
  /** Shown on the wide render only; a phone gets the calmer scene. */
  wideOnly?: boolean;
}
export interface SceneSpecks {
  kind: "petal" | "bubble";
  /** Colour roles in turn (styles/meadow-colours.css). */
  colours: readonly ("petal" | "pink" | "gold" | "cream" | "violet" | "apricot")[];
}
export interface Scene {
  layers: readonly SceneLayer[];
  sprites: readonly SceneSprite[];
  specks: SceneSpecks;
}

export const SCENES: Record<SceneName, Scene> = {
  paddock: {
    layers: [
      { piece: "live-paddock-land", motion: "still" },
      { piece: "live-paddock-tail", motion: "swish", pivot: "paddock-tail" },
      { piece: "live-paddock-horse", motion: "still" },
      { piece: "live-paddock-head", motion: "graze", pivot: "paddock-head" },
      { piece: "live-paddock-sway-b", motion: "sway-late" },
      { piece: "live-paddock-sway-a", motion: "sway" },
    ],
    sprites: [
      { piece: "vista-butterfly-red", path: "loop", beat: "wings", x: 0.2, y: 0.5 },
      { piece: "vista-butterfly-gold", path: "drift", beat: "wings", x: 0.72, y: 0.58 },
      { piece: "vista-butterfly-violet", path: "loop", beat: "wings", x: 0.86, y: 0.42, wideOnly: true },
    ],
    specks: { kind: "petal", colours: ["petal", "pink", "gold", "cream", "violet"] },
  },
  meadow: {
    layers: [
      { piece: "live-meadow-land", motion: "still" },
      { piece: "live-meadow-sway-b", motion: "sway-late" },
      { piece: "live-meadow-sway-a", motion: "sway" },
    ],
    sprites: [
      { piece: "vista-butterfly-red", path: "drift", beat: "wings", x: 0.3, y: 0.42 },
      { piece: "vista-butterfly-gold", path: "loop", beat: "wings", x: 0.78, y: 0.36, wideOnly: true },
    ],
    specks: { kind: "petal", colours: ["petal", "pink", "gold", "cream", "violet"] },
  },
  pond: {
    layers: [
      { piece: "live-pond-land", motion: "still" },
      { piece: "live-pond-ripples-a", motion: "twinkle" },
      { piece: "live-pond-ripples-b", motion: "twinkle-late" },
      { piece: "live-pond-glint", motion: "twinkle-late" },
      { piece: "live-pond-reeds-b", motion: "sway-late" },
      { piece: "live-pond-pads-a", motion: "bob" },
      { piece: "live-pond-pads-b", motion: "bob-late" },
      { piece: "live-pond-reeds-a", motion: "sway" },
    ],
    sprites: [
      { piece: "live-dragonfly", path: "hover", beat: "dragonfly", x: 0.36, y: 0.3 },
      { piece: "live-dragonfly", path: "dart", beat: "dragonfly", x: 0.6, y: 0.42, wideOnly: true },
      { piece: "vista-butterfly-violet", path: "drift", beat: "wings", x: 0.66, y: 0.22 },
    ],
    specks: { kind: "petal", colours: ["pink", "petal", "cream"] },
  },
  reef: {
    layers: [
      { piece: "live-reef-land", motion: "still" },
      { piece: "live-reef-weed-b", motion: "sway-late" },
      { piece: "live-reef-arms", motion: "curl", pivot: "reef-arms" },
      { piece: "live-reef-head", motion: "breathe", pivot: "reef-head" },
      { piece: "live-reef-weed-a", motion: "sway" },
    ],
    sprites: [
      { piece: "live-fish-gold", path: "swim-left", beat: "fins", x: 0.62, y: 0.3 },
      { piece: "live-fish-apricot", path: "swim-right", beat: "fins", x: 0.22, y: 0.18 },
      { piece: "live-fish-violet", path: "swim-far", beat: "fins", x: 0.8, y: 0.52, wideOnly: true },
    ],
    specks: { kind: "bubble", colours: ["cream"] },
  },
};

/** How many loose petals or bubbles a scene carries; the CSS gives each its own path and timing. */
export const SPECKS = 8;

/** A pivot as a CSS `transform-origin` value for the wide and the narrow render. */
export function pivotOf(key: SceneLayer["pivot"]): { wide: string; narrow: string } | undefined {
  if (!key) return undefined;
  const css = (p: number[]) => `${((p[0] ?? 0) * 100).toFixed(3)}% ${((p[1] ?? 0) * 100).toFixed(3)}%`;
  return { wide: css(geometry.pivots.wide[key]), narrow: css(geometry.pivots.narrow[key]) };
}

/** The stage's aspect ratios and the dragonfly's wing root, as CSS values. */
export const STAGE = {
  wide: `${geometry.stage.wide[0]} / ${geometry.stage.wide[1]}`,
  narrow: `${geometry.stage.narrow[0]} / ${geometry.stage.narrow[1]}`,
  wideWidth: geometry.stage.wide[0] ?? 0,
  narrowWidth: geometry.stage.narrow[0] ?? 0,
  wideCell: geometry.cell.wide,
  narrowCell: geometry.cell.narrow,
  wingRoot: `${(geometry.dragonflyWingRoot * 100).toFixed(3)}%`,
};
