import { create } from "zustand";
import manifest from "../../../../../assets/wallpapers/manifest.json";
import { useDockStore } from "../store";
import { dev } from "./devBackend";

/**
 * DEV ONLY. The desktop behind the dock in the fixture is one of the app's own wallpapers, full size, so glass and every
 * theme are judged over the images the dock will really sit on. Only the styles the owner approved are offered:
 * no stripes, no gradients and no placeholder backdrops.
 */
export const DEV_WALLPAPER_IDS = ["halftone-ridge", "meadow-dots", "soft-mono", "bloom-dots", "flute-flower"] as const;
export type DevWallpaperId = (typeof DEV_WALLPAPER_IDS)[number];
export type WallpaperMode = "dark" | "light";

/** The windswept green grass: the owner's choice of backdrop for tests, live runs and captures. */
export const DEFAULT_WALLPAPER: DevWallpaperId = "meadow-dots";

/** Display names come from the wallpaper manifest, so the picker says what the app's own picker says. */
export const DEV_WALLPAPERS: readonly { readonly id: DevWallpaperId; readonly name: string }[] = DEV_WALLPAPER_IDS.map((id) => ({
  id,
  name: manifest.wallpapers.find((w) => w.id === id)?.name ?? id,
}));

const urls = import.meta.glob<string>("../../../../../assets/wallpapers/{halftone-ridge,meadow-dots,soft-mono,bloom-dots,flute-flower}-{dark,light}.jpg", {
  query: "?url",
  import: "default",
});

const fileFor = (id: DevWallpaperId, mode: WallpaperMode): string => `../../../../../assets/wallpapers/${id}-${mode}.jpg`;

export const isWallpaperId = (value: string): value is DevWallpaperId => (DEV_WALLPAPER_IDS as readonly string[]).includes(value);

/** `halftone-ridge-dark` (the page address's `?wall=`) as a style and a mode, or null when it is neither. */
export function parseWallpaper(value: string | null): { id: DevWallpaperId; mode: WallpaperMode } | null {
  const match = value === null ? null : /^(.+)-(dark|light)$/.exec(value);
  const id = match?.[1];
  return id !== undefined && isWallpaperId(id) ? { id, mode: match?.[2] === "light" ? "light" : "dark" } : null;
}

interface WallpaperState {
  readonly id: DevWallpaperId;
  readonly mode: WallpaperMode;
}

export const useDevWallpaper = create<WallpaperState>(() => ({ id: DEFAULT_WALLPAPER, mode: "dark" }));

let backdrop: HTMLElement | null = null;

async function paint(): Promise<void> {
  const { id, mode } = useDevWallpaper.getState();
  const load = urls[fileFor(id, mode)];
  if (backdrop && load) backdrop.style.backgroundImage = `url(${await load()})`;
}

/**
 * Puts the wallpaper behind the transparent dock window and tells the dock what the core would: how light the desktop
 * is. Changing wallpaper in the fixture is the same event as the user changing it on the real desktop.
 */
export function setWallpaper(next: Partial<WallpaperState>): void {
  useDevWallpaper.setState(next);
  const { mode } = useDevWallpaper.getState();
  dev.backdrop({ ...useDockStore.getState().backdrop, tone: mode });
  void paint();
}

export function installBackdrop(initial: WallpaperState): void {
  backdrop = document.createElement("div");
  backdrop.className = "dev-backdrop";
  document.body.prepend(backdrop);
  // The wallpaper is painted inside the page here, so the bar's CSS blur really frosts it: glass is available, as it
  // is on the desktop when the host has put the native acrylic behind the window.
  dev.backdrop({ ...useDockStore.getState().backdrop, available: true });
  setWallpaper(initial);
}
