import { afterEach, describe, expect, it, vi } from "vitest";
import { AURUM, OBSIDIAN, PAPER } from "../design-system/themes";
import { DEFAULT_BACKDROP, DEFAULT_THEME, DOCK_THEMES, isDockTheme, isTranslucent, paletteFor, readThemeChoice, resolveTheme, saveThemeChoice, THEME_STORAGE_KEY, type Backdrop } from "./theme";

const blur: Backdrop = { available: true, tone: "dark", saver: false };

describe("resolveTheme", () => {
  it("draws glass when the blur is available and nothing asks for less", () => {
    expect(resolveTheme("glass", "full", blur)).toBe("glass");
  });

  it("steps down to glass-lite when effects are lite, the blur is unavailable or battery saver is on", () => {
    expect(resolveTheme("glass", "lite", blur)).toBe("glass-lite");
    expect(resolveTheme("glass", "full", { ...blur, available: false })).toBe("glass-lite");
    expect(resolveTheme("glass", "full", { ...blur, saver: true })).toBe("glass-lite");
  });

  it("starts as glass-lite until the core has said the blur works", () => {
    expect(resolveTheme("glass", "full", DEFAULT_BACKDROP)).toBe("glass-lite");
  });

  it("never changes a theme the user chose that is not glass", () => {
    for (const theme of DOCK_THEMES.filter((t) => t !== "glass")) {
      expect(resolveTheme(theme, "lite", { ...blur, available: false, saver: true })).toBe(theme);
    }
  });
});

describe("paletteFor", () => {
  it("gives each solid theme its own palette whatever the app theme and desktop are", () => {
    expect(paletteFor("obsidian", "light", "light")).toBe(OBSIDIAN);
    expect(paletteFor("paper", "dark", "dark")).toBe(PAPER);
    expect(paletteFor("aurum", null, "light")).toBe(AURUM);
  });

  it("lets a translucent bar inherit the app theme when it suits the desktop behind it", () => {
    expect(paletteFor("glass", "dark", "dark")).toBeNull();
    expect(paletteFor("glass-lite", "light", "light")).toBeNull();
    expect(paletteFor("minimal", "dark", "dark")).toBeNull();
  });

  it("lets it inherit while the desktop's tone is unknown", () => {
    expect(paletteFor("glass", null, "dark")).toBeNull();
    expect(paletteFor("glass", null, "light")).toBeNull();
  });

  it("takes the matching built-in palette when the app theme would sit dark on dark or light on light", () => {
    expect(paletteFor("glass", "light", "dark")).toBe(PAPER);
    expect(paletteFor("glass", "dark", "light")).toBe(OBSIDIAN);
    expect(paletteFor("minimal", "light", "dark")).toBe(PAPER);
  });
});

describe("isTranslucent", () => {
  it("is true for the two glass themes only", () => {
    expect(DOCK_THEMES.filter(isTranslucent)).toEqual(["glass", "glass-lite"]);
  });
});

describe("the saved choice", () => {
  const stubPage = (search: string, stored: string | null) => {
    vi.stubGlobal("location", { search });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => (key === THEME_STORAGE_KEY ? stored : null),
      setItem: vi.fn(),
    });
  };
  afterEach(() => vi.unstubAllGlobals());

  it("is glass when nothing was chosen", () => {
    stubPage("", null);
    expect(readThemeChoice()).toBe(DEFAULT_THEME);
    expect(DEFAULT_THEME).toBe("glass");
  });

  it("reads what was saved and ignores what is not a theme", () => {
    stubPage("", "paper");
    expect(readThemeChoice()).toBe("paper");
    stubPage("", "neon");
    expect(readThemeChoice()).toBe("glass");
  });

  it("lets the page address pin a theme for a preview", () => {
    stubPage("?dock-theme=minimal", "paper");
    expect(readThemeChoice()).toBe("minimal");
    stubPage("?dock-theme=nope", "paper");
    expect(readThemeChoice()).toBe("paper");
  });

  it("falls back to glass when storage cannot be read", () => {
    vi.stubGlobal("location", { search: "" });
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
    });
    expect(readThemeChoice()).toBe("glass");
  });

  it("saves the choice, and survives storage that refuses it", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { setItem });
    saveThemeChoice("aurum");
    expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, "aurum");
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new Error("full");
      },
    });
    expect(() => saveThemeChoice("paper")).not.toThrow();
  });

  it("knows which strings are themes", () => {
    expect(isDockTheme("glass-lite")).toBe(true);
    expect(isDockTheme("Glass")).toBe(false);
    expect(isDockTheme(null)).toBe(false);
  });
});
