/**
 * Decoded copies of a photo at the sizes it is shown at.
 *
 * Handing a 24 MP JPEG to an <img> makes the browser decode it on the main thread the first time
 * it is drawn at a new scale (measured: 130 to 165 ms, a visible hitch). Instead the widget asks
 * for a copy at a size bucket: `createImageBitmap` with resize options decodes and downsamples off
 * the main thread, the old copy stays on screen until the new one is ready, and the copies are
 * kept, so going back to a preset costs nothing.
 *
 * Buckets climb a geometric ladder, so a copy is at most one step larger than the pixels it fills
 * (the compositor's last downscale is under 19 %) and nearby sizes share a copy. A copy is never
 * larger than the original.
 */

/** The smallest copy, in device px across. */
export const MIN_BUCKET = 256;
/** Each bucket is this much wider than the one below it (four steps per doubling). */
export const BUCKET_STEP = 2 ** (1 / 4);
/** Copies kept per photo. Each one is width x height x 4 bytes; three cover a resize back and forth. */
export const KEPT_COPIES = 3;

/** The width of the copy to decode for an image drawn `targetPx` device px wide. */
export function bucketWidth(targetPx: number, originalPx: number): number {
  if (!(originalPx > 0)) return 0;
  if (!(targetPx > MIN_BUCKET)) return Math.min(MIN_BUCKET, originalPx);
  const steps = Math.ceil(Math.log(targetPx / MIN_BUCKET) / Math.log(BUCKET_STEP) - 1e-9);
  return Math.min(originalPx, Math.round(MIN_BUCKET * BUCKET_STEP ** steps));
}

export interface Closable {
  close(): void;
}

/** Asked of a cache after `dispose`: its photo has been replaced or its widget removed. */
export class CacheDisposedError extends Error {
  constructor() {
    super("The photo's decoded copies were released");
    this.name = "CacheDisposedError";
  }
}

/**
 * The copies of one photo, most recently used last. `decode` makes a copy of a given width; a
 * copy pushed out by a newer one is closed once its decode has finished.
 */
export class CopyCache<T extends Closable> {
  private readonly copies = new Map<number, Promise<T>>();
  private disposed = false;

  constructor(
    private readonly decode: (width: number) => Promise<T>,
    private readonly keep: number = KEPT_COPIES,
  ) {}

  get(width: number): Promise<T> {
    if (this.disposed) return Promise.reject(new CacheDisposedError());
    const known = this.copies.get(width);
    if (known) {
      this.copies.delete(width);
      this.copies.set(width, known);
      return known;
    }
    const made = this.decode(width);
    this.copies.set(width, made);
    // A failed decode is not kept, so the next request tries again.
    made.catch(() => {
      if (this.copies.get(width) === made) this.copies.delete(width);
    });
    while (this.copies.size > this.keep) {
      const [oldest, copy] = this.copies.entries().next().value as [number, Promise<T>];
      this.copies.delete(oldest);
      copy.then((c) => c.close()).catch(() => undefined);
    }
    return made;
  }

  /** Closes every copy; the cache must not be used afterwards. */
  dispose(): void {
    this.disposed = true;
    for (const copy of this.copies.values()) copy.then((c) => c.close()).catch(() => undefined);
    this.copies.clear();
  }
}

/** A cache that decodes `blob`, whose oriented size is `width` x `height`, with the browser's best resampling. */
export function bitmapCache(blob: Blob, width: number, height: number): CopyCache<ImageBitmap> {
  return new CopyCache((w) =>
    createImageBitmap(blob, {
      resizeWidth: w,
      resizeHeight: Math.max(1, Math.round((w * height) / width)),
      resizeQuality: "high",
      // The size is the oriented one, so the copy must be turned upright before it is resized.
      imageOrientation: "from-image",
    }),
  );
}

/** A canvas, or a stand-in for one in tests, that takes ownership of a decoded bitmap. */
export interface BitmapTarget<T> {
  width: number;
  height: number;
  getContext(kind: "bitmaprenderer"): { transferFromImageBitmap(bitmap: T): void } | null;
}

/** What `drawCopy` did: drew the copy, or dropped it because the request was no longer wanted. */
export type DrawResult = "drawn" | "stale";

/**
 * Draws the copy of width `width` into the target. The cache keeps its copy for later sizes, so
 * the target takes a clone it can own. `live` is asked before and after cloning: a request that
 * was replaced or unmounted meanwhile clones nothing, or closes its clone, so no bitmap leaks.
 */
export async function drawCopy<T extends Closable & { readonly width: number; readonly height: number }>(
  copies: CopyCache<T>,
  width: number,
  live: () => boolean,
  target: () => BitmapTarget<T> | null,
  clone: (copy: T) => Promise<T>,
): Promise<DrawResult> {
  const copy = await copies.get(width);
  if (!live()) return "stale";
  const owned = await clone(copy);
  const canvas = live() ? target() : null;
  const context = canvas?.getContext("bitmaprenderer") ?? null;
  if (!canvas || !context) {
    owned.close();
    return "stale";
  }
  canvas.width = owned.width;
  canvas.height = owned.height;
  context.transferFromImageBitmap(owned);
  return "drawn";
}
