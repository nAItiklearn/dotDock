/** What a photo widget remembers per copy: its sizes, its settings schema and the defaults. */
import type { ConfigSchema, TitledOption } from "../configSchema";
import type { SizeSpec } from "../sizes";
import type { PhotoFit } from "./frame";
import { MAX_CAPTION_LENGTH, type LookSettings, type PhotoFrame, type PhotoShape, type PhotoTint } from "./look";

export type PhotoTone = "colour" | "mono" | "duotone";

export interface PhotoConfig extends LookSettings {
  readonly fit: PhotoFit;
  readonly tone: PhotoTone;
}

/**
 * Footprints on the home grid. Large comes first so a new photo starts big, and the four t-shirt
 * ids are the ones layouts saved before the border options already hold. Edit mode snaps a resize
 * to the nearest footprint listed here, so this list is also the ladder the corner handle climbs.
 */
export const PHOTO_SIZES: readonly SizeSpec[] = [
  { id: "l", name: "Large", w: 4, h: 4 },
  { id: "medium", name: "Medium", w: 3, h: 3 },
  { id: "s", name: "Small", w: 2, h: 2 },
  { id: "m", name: "Wide", w: 4, h: 2 },
  { id: "landscape", name: "Landscape", w: 4, h: 3 },
  { id: "tall", name: "Tall", w: 2, h: 4 },
  { id: "xl", name: "Portrait", w: 3, h: 4 },
  { id: "panorama", name: "Panorama", w: 6, h: 2 },
];

/**
 * Corner radius and border width are px on the spacing grid (`--space-1`). The defaults are the
 * values the widget had before it had border options: `--radius-lg` corners and a `--space-3` mat.
 */
export const RADIUS = { min: 0, max: 40, step: 4, initial: 28 } as const;
export const THICKNESS = { min: 4, max: 32, step: 4, initial: 12 } as const;

export const DEFAULT_PHOTO_CONFIG: PhotoConfig = {
  fit: "fill",
  frame: "none",
  shape: "rounded",
  radius: RADIUS.initial,
  thickness: THICKNESS.initial,
  tint: "paper",
  caption: "",
  shadow: true,
  tone: "colour",
};

const FRAMES: readonly (TitledOption & { readonly const: PhotoFrame })[] = [
  { const: "none", title: "Edge to edge" },
  { const: "hairline", title: "Keyline" },
  { const: "mat", title: "Mat" },
  { const: "polaroid", title: "Polaroid" },
  { const: "dots", title: "Dot matrix" },
];

const SHAPES: readonly (TitledOption & { readonly const: PhotoShape })[] = [
  { const: "rounded", title: "Rounded" },
  { const: "squircle", title: "Squircle" },
  { const: "circle", title: "Circle or pill" },
];

/** Border colours are tokens: paper and ink are the same in every theme, grey and accent follow the theme. */
const TINTS: readonly (TitledOption & { readonly const: PhotoTint })[] = [
  { const: "paper", title: "Paper", swatch: "--photo-mat" },
  { const: "ink", title: "Ink", swatch: "--photo-ink" },
  { const: "dim", title: "Grey", swatch: "--text-dim" },
  { const: "accent", title: "Accent", swatch: "--accent" },
];

/** Frames that have a band around the photo. */
const BANDED: readonly PhotoFrame[] = ["hairline", "mat", "polaroid", "dots"];
/** Frames a shape mask can be applied to. */
const MASKABLE: readonly PhotoFrame[] = ["none", "hairline", "mat", "dots"];

export const PHOTO_SCHEMA: ConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    fit: {
      type: "string",
      title: "Fit",
      default: DEFAULT_PHOTO_CONFIG.fit,
      oneOf: [
        { const: "fill", title: "Fill the frame" },
        { const: "fit", title: "Show the whole photo" },
      ],
    },
    frame: {
      type: "string",
      title: "Border",
      default: DEFAULT_PHOTO_CONFIG.frame,
      // Before the border options this was a two-way "mat" setting; its values are still valid.
      replaces: "mat",
      oneOf: FRAMES,
    },
    thickness: {
      type: "number",
      title: "Border width",
      default: DEFAULT_PHOTO_CONFIG.thickness,
      minimum: THICKNESS.min,
      maximum: THICKNESS.max,
      multipleOf: THICKNESS.step,
      unit: "px",
      appliesWhen: [{ frame: BANDED }],
    },
    tint: {
      type: "string",
      title: "Border colour",
      default: DEFAULT_PHOTO_CONFIG.tint,
      oneOf: TINTS,
      appliesWhen: [{ frame: BANDED }],
    },
    caption: {
      type: "string",
      title: "Caption",
      default: DEFAULT_PHOTO_CONFIG.caption,
      maxLength: MAX_CAPTION_LENGTH,
      appliesWhen: [{ frame: ["polaroid"] }],
    },
    shape: {
      type: "string",
      title: "Shape",
      default: DEFAULT_PHOTO_CONFIG.shape,
      oneOf: SHAPES,
      appliesWhen: [{ frame: MASKABLE }],
    },
    radius: {
      type: "number",
      title: "Corner radius",
      default: DEFAULT_PHOTO_CONFIG.radius,
      minimum: RADIUS.min,
      maximum: RADIUS.max,
      multipleOf: RADIUS.step,
      unit: "px",
      // A circle has no corners; a polaroid always has them.
      appliesWhen: [{ shape: ["rounded", "squircle"] }, { frame: ["polaroid"] }],
    },
    shadow: {
      type: "boolean",
      title: "Shadow",
      default: DEFAULT_PHOTO_CONFIG.shadow,
    },
    tone: {
      type: "string",
      title: "Photo colour",
      default: DEFAULT_PHOTO_CONFIG.tone,
      oneOf: [
        { const: "colour", title: "Original" },
        { const: "mono", title: "Black and white" },
        { const: "duotone", title: "Accent duotone" },
      ],
    },
  },
};
