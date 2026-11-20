/**
 * A sample photo for the widget gallery only, so every border and size of the photo widget can be
 * reviewed in a plain browser. Product code never imports this file.
 */
import { readPhotoFile, savePhoto } from "../photo/blobs";
import { CENTRED, type Framing } from "../photo/frame";
import { usePhotoStore } from "../photo/store";

/** An original generated image from this repository (assets/web), used unless `?photo=` names another. */
export const DEFAULT_SAMPLE_PHOTO = "/wallpaper-thumbs/halftone-ridge-dark.jpg";

/** Stores the sample photo under each placement id and sets its framing, as picking a file would. */
export async function seedPhotos(ids: readonly string[], url: string, framing: Framing = CENTRED): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The sample photo ${url} could not be loaded (${response.status})`);
  const blob = await response.blob();
  const read = await readPhotoFile(new File([blob], url.split("/").pop() ?? "sample", { type: blob.type }));
  if (typeof read === "string") throw new Error(`The sample photo ${url} was refused: ${read}`);
  for (const id of ids) {
    await savePhoto(id, read);
    usePhotoStore.getState().replaced(id);
    usePhotoStore.getState().frame(id, framing);
  }
}
