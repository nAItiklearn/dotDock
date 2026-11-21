import { MAX_SAMPLES, type PixelGrid } from "./palette";

/** The longest side a picture is shrunk to before its colours are read: about as many pixels as the palette looks at. */
export const SAMPLE_EDGE = Math.floor(Math.sqrt(MAX_SAMPLES));

export class UnreadableImageError extends Error {
  constructor() {
    super("That file isn't a picture this app can read.");
    this.name = "UnreadableImageError";
  }
}

/** Decodes an image file in the webview and shrinks it to a small grid of pixels. */
export async function sampleImage(file: Blob): Promise<PixelGrid> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new UnreadableImageError();
  }
  try {
    const scale = Math.min(1, SAMPLE_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new UnreadableImageError();
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    return { width, height, data: context.getImageData(0, 0, width, height).data };
  } finally {
    bitmap.close();
  }
}
