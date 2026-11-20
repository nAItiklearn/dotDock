import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("location", { search: "" });
const { DEFAULT_WALLPAPER, DEV_WALLPAPER_IDS, DEV_WALLPAPERS, isWallpaperId, parseWallpaper } = await import("./wallpapers");

const here = dirname(fileURLToPath(import.meta.url));
const wallpaperDir = resolve(here, "../../../../../assets/wallpapers");

describe("the harness backdrop", () => {
  it("offers only the approved halftone, meadow, petal, bloom and flower wallpapers", () => {
    expect([...DEV_WALLPAPER_IDS]).toEqual(["halftone-ridge", "meadow-dots", "soft-mono", "bloom-dots", "flute-flower"]);
  });

  it("never offers a striped or gradient style, and starts on the halftone ridge", () => {
    for (const banned of ["louver-silver", "louver-ember", "arc-red", "arc-cyan", "liquid-gold", "red-waves", "glass-orbs"]) {
      expect(isWallpaperId(banned)).toBe(false);
    }
    expect(DEFAULT_WALLPAPER).toBe("halftone-ridge");
  });

  it("has a full-size dark and light image on disk for every style", () => {
    for (const id of DEV_WALLPAPER_IDS) {
      for (const mode of ["dark", "light"]) expect(existsSync(resolve(wallpaperDir, `${id}-${mode}.jpg`))).toBe(true);
    }
  });

  it("names each style as the app's own wallpaper picker does", () => {
    expect(DEV_WALLPAPERS.map((w) => w.name)).toEqual(["Screen Ridge", "Wind Meadow", "Petal Haze", "Lattice Bloom", "Reeded Violet"]);
  });
});

describe("parseWallpaper", () => {
  it("reads a style and a mode from the page address", () => {
    expect(parseWallpaper("meadow-dots-light")).toEqual({ id: "meadow-dots", mode: "light" });
    expect(parseWallpaper("halftone-ridge-dark")).toEqual({ id: "halftone-ridge", mode: "dark" });
  });

  it("ignores anything that is not one of the approved styles", () => {
    expect(parseWallpaper("louver-silver-dark")).toBeNull();
    expect(parseWallpaper("halftone-ridge")).toBeNull();
    expect(parseWallpaper("")).toBeNull();
    expect(parseWallpaper(null)).toBeNull();
  });
});
