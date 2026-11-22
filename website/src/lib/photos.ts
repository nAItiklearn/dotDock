/**
 * Which picture the photo widget shows. By default it is one of this project's own pictures. The owner's own
 * photos are shown only when the site is built with DOTDOCK_OWNER_PHOTOS=1 and the files are in
 * website/private-photos/ (git-ignored, never committed): they show public figures, and they are not published
 * until the owner confirms the rights (docs/BLOCKERS.md).
 */

/** The build flag's name; `1` turns the owner's photos on. */
export const OWNER_PHOTOS_FLAG = "DOTDOCK_OWNER_PHOTOS";

/** Is the flag on, given the environment the site is built in? Only the exact value `1` counts. */
export function ownerPhotosOn(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[OWNER_PHOTOS_FLAG] === "1";
}

/** The owner's photo for slot `index`, or null for the project's own picture. Photos are taken in file-name order. */
export function pickPhoto<T>(on: boolean, photos: Readonly<Record<string, T>>, index: number): T | null {
  if (!on) return null;
  const names = Object.keys(photos).sort();
  if (names.length === 0) return null;
  const name = names[((index % names.length) + names.length) % names.length] as string;
  return photos[name] ?? null;
}
