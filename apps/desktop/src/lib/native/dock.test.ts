import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { clampIconSize, clampMagnification, DEFAULT_DOCK_THEME, DOCK_ICON_LIMITS, DOCK_MAGNIFICATION_LIMITS, DOCK_THEMES, moveBy, readDockTheme, removeAt, saveDockTheme } from "./dock";

/** The dock's own theme registry. On a build without the dock UI it is absent and Settings' copy stands alone. */
const DOCK_THEME_REGISTRY = resolve(__dirname, "../../dock/theme.ts");

/** The ids in `export const DOCK_THEMES = [...] as const` of a source file. */
function registryThemes(source: string): string[] {
  const list = /export const DOCK_THEMES\s*=\s*\[([^\]]*)\]/.exec(source)?.[1] ?? "";
  return [...list.matchAll(/["']([a-z-]+)["']/g)].map((m) => m[1] as string);
}

describe("dock themes in Settings", () => {
  it("are exactly the dock's own registry, so a theme the dock drops leaves Settings too", () => {
    if (!existsSync(DOCK_THEME_REGISTRY)) return;
    expect([...DOCK_THEMES]).toEqual(registryThemes(readFileSync(DOCK_THEME_REGISTRY, "utf8")));
  });

  it("reads the registry literal", () => {
    expect(registryThemes('export const DOCK_THEMES = ["glass", "paper"] as const;')).toEqual(["glass", "paper"]);
  });

  it("round-trip through the storage key the dock reads, and fall back to the default on junk", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    saveDockTheme("aurum", storage);
    expect(readDockTheme(storage)).toBe("aurum");
    store.set("dotdock.dock.theme", "neon");
    expect(readDockTheme(storage)).toBe(DEFAULT_DOCK_THEME);
  });
});

describe("dock limits and lists", () => {
  it("clamp to what the dock draws", () => {
    expect(clampIconSize(500)).toBe(DOCK_ICON_LIMITS.max);
    expect(clampIconSize(Number.NaN)).toBe(DOCK_ICON_LIMITS.default);
    expect(clampMagnification(0.2)).toBe(DOCK_MAGNIFICATION_LIMITS.min);
  });

  it("move and remove without going out of bounds", () => {
    expect(moveBy(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveBy(["a", "b"], 1, 1)).toEqual(["a", "b"]);
    expect(removeAt(["a", "b"], 0)).toEqual(["b"]);
  });
});
