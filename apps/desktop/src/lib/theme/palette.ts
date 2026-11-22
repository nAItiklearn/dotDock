import type { Rgba } from "./color";
import { oklchToRgb, rgbToOklch, type Oklch } from "./oklch";

/**
 * Colours of a picture, found the way a person would list them: group the pixels by how alike they
 * look (in OKLab, where distance matches what the eye sees), then rank the groups. Pure and
 * deterministic: the same picture always gives the same palette.
 */

/** Pixels as a canvas hands them over: 8-bit red, green, blue, alpha, row by row. */
export interface PixelGrid {
  readonly width: number;
  readonly height: number;
  readonly data: ArrayLike<number>;
}

/** One group of alike colours in the picture. */
export interface Swatch {
  readonly color: Rgba;
  readonly lch: Oklch;
  /** Fraction of the picture's pixels in this group, 0..1. */
  readonly share: number;
}

export interface WallpaperPalette {
  /** Largest group first. */
  readonly swatches: readonly Swatch[];
  /** The largest group: the colour most of the picture is made of. */
  readonly backdrop: Swatch;
  /** Mean OKLab lightness of the picture, 0 (black) to 1 (white). */
  readonly lightness: number;
  /** Groups vivid enough to be an accent, best first, each a distinct hue. Empty for a picture with no colour. */
  readonly accents: readonly Swatch[];
}

/** How many groups to look for. Eight is enough to separate sky, ground and a few highlights. */
export const SWATCH_COUNT = 8;
/** A picture is looked at through at most this many pixels; larger grids are sampled evenly. */
export const MAX_SAMPLES = 4096;
/** A pixel less than half opaque is not part of the picture. */
const MIN_ALPHA = 128;
const KMEANS_ROUNDS = 12;
/** Two pixels this close (OKLab distance, squared) are the same colour for seeding purposes. */
const SAME_COLOR = 1e-6;
/** Below this OKLCH chroma a colour reads as grey and cannot be an accent. */
export const ACCENT_MIN_CHROMA = 0.05;
/** A group smaller than this share of the picture is noise, not a colour. */
const ACCENT_MIN_SHARE = 0.01;
/** From this share up a group counts in full; below it, in proportion. */
const ACCENT_FULL_SHARE = 0.05;
/** Accent candidates must differ in hue by at least this many degrees. */
const ACCENT_HUE_GAP = 25;
const ACCENT_LIMIT = 4;
const HALF_TURN = 180;
const FULL_TURN = 360;

interface Lab {
  readonly l: number;
  readonly a: number;
  readonly b: number;
}

const BYTE = 255;
const GREY_CHROMA = 1e-4;

function toLab({ l, c, h }: Oklch): Lab {
  const rad = (h * Math.PI) / HALF_TURN;
  return { l, a: c * Math.cos(rad), b: c * Math.sin(rad) };
}

function fromLab({ l, a, b }: Lab): Oklch {
  const c = Math.hypot(a, b);
  return { l, c, h: c < GREY_CHROMA ? 0 : ((Math.atan2(b, a) * HALF_TURN) / Math.PI + FULL_TURN) % FULL_TURN };
}

const distance2 = (p: Lab, q: Lab): number => (p.l - q.l) ** 2 + (p.a - q.a) ** 2 + (p.b - q.b) ** 2;

/** The shorter way round the colour wheel between two hues, 0..180 degrees. */
export function hueDistance(a: number, b: number): number {
  const turn = (((a - b) % FULL_TURN) + FULL_TURN) % FULL_TURN;
  return turn > HALF_TURN ? FULL_TURN - turn : turn;
}

/** The opaque pixels of the grid in OKLab, taking every n-th so no more than MAX_SAMPLES are read. */
function sample(grid: PixelGrid): Lab[] {
  const pixels = Math.min(grid.width * grid.height, Math.floor(grid.data.length / 4));
  const stride = Math.max(1, Math.ceil(pixels / MAX_SAMPLES));
  const seen = new Map<number, Lab>();
  const labs: Lab[] = [];
  for (let p = 0; p < pixels; p += stride) {
    const i = p * 4;
    if ((grid.data[i + 3] ?? 0) < MIN_ALPHA) continue;
    const r = grid.data[i] ?? 0;
    const g = grid.data[i + 1] ?? 0;
    const b = grid.data[i + 2] ?? 0;
    const key = (r * (BYTE + 1) + g) * (BYTE + 1) + b;
    let lab = seen.get(key);
    if (!lab) {
      lab = toLab(rgbToOklch({ r, g, b, a: 1 }));
      seen.set(key, lab);
    }
    labs.push(lab);
  }
  return labs;
}

interface Cluster {
  readonly center: Lab;
  readonly count: number;
}

/**
 * K-means seeded without chance: the first centre is the sample nearest the mean, each next one the
 * sample farthest from every centre so far. Stops early when the picture has fewer distinct colours than `k`.
 */
function cluster(samples: readonly Lab[], k: number): Cluster[] {
  const mean = samples.reduce((m, s) => ({ l: m.l + s.l, a: m.a + s.a, b: m.b + s.b }), { l: 0, a: 0, b: 0 });
  const centre = { l: mean.l / samples.length, a: mean.a / samples.length, b: mean.b / samples.length };
  let centers: Lab[] = [samples.reduce((best, s) => (distance2(s, centre) < distance2(best, centre) ? s : best))];
  while (centers.length < k) {
    let farthest = samples[0] as Lab;
    let farthestGap = -1;
    for (const s of samples) {
      const gap = Math.min(...centers.map((c) => distance2(s, c)));
      if (gap > farthestGap) {
        farthest = s;
        farthestGap = gap;
      }
    }
    if (farthestGap <= SAME_COLOR) break;
    centers = [...centers, farthest];
  }

  let counts: number[] = [];
  for (let round = 0; round < KMEANS_ROUNDS; round++) {
    const sums = centers.map(() => ({ l: 0, a: 0, b: 0, n: 0 }));
    for (const s of samples) {
      let nearest = 0;
      let nearestGap = Infinity;
      centers.forEach((c, index) => {
        const gap = distance2(s, c);
        if (gap < nearestGap) {
          nearest = index;
          nearestGap = gap;
        }
      });
      const sum = sums[nearest] as (typeof sums)[number];
      sum.l += s.l;
      sum.a += s.a;
      sum.b += s.b;
      sum.n += 1;
    }
    const next = sums.map((s, index) => (s.n === 0 ? (centers[index] as Lab) : { l: s.l / s.n, a: s.a / s.n, b: s.b / s.n }));
    const moved = next.some((c, index) => distance2(c, centers[index] as Lab) > SAME_COLOR);
    centers = next;
    counts = sums.map((s) => s.n);
    if (!moved) break;
  }
  return centers.map((center, index) => ({ center, count: counts[index] ?? 0 })).filter((c) => c.count > 0);
}

function toSwatch(c: Cluster, total: number): Swatch {
  const color = oklchToRgb(fromLab(c.center));
  return { color, lch: rgbToOklch(color), share: c.count / total };
}

/** Vivid groups with enough presence, ranked by chroma (damped for small ones), one per hue region. */
function pickAccents(swatches: readonly Swatch[]): Swatch[] {
  const score = (s: Swatch): number => s.lch.c * Math.min(1, s.share / ACCENT_FULL_SHARE);
  const ranked = swatches
    .filter((s) => s.lch.c >= ACCENT_MIN_CHROMA && s.share >= ACCENT_MIN_SHARE)
    .sort((x, y) => score(y) - score(x));
  const kept: Swatch[] = [];
  for (const s of ranked) {
    if (kept.every((k) => hueDistance(k.lch.h, s.lch.h) >= ACCENT_HUE_GAP)) kept.push(s);
    if (kept.length === ACCENT_LIMIT) break;
  }
  return kept;
}

/** The palette of a picture, or null when it has no opaque pixel to look at. */
export function extractPalette(grid: PixelGrid): WallpaperPalette | null {
  const samples = sample(grid);
  if (samples.length === 0) return null;
  const swatches = cluster(samples, SWATCH_COUNT)
    .map((c) => toSwatch(c, samples.length))
    .sort((x, y) => y.share - x.share);
  const backdrop = swatches[0] as Swatch;
  const lightness = samples.reduce((sum, s) => sum + s.l, 0) / samples.length;
  return { swatches, backdrop, lightness, accents: pickAccents(swatches) };
}
