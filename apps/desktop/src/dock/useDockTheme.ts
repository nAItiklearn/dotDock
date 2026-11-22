import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { applyTheme, clearTheme, type Theme } from "../design-system/themes";
import { useDockStore } from "./store";
import { paletteFor, type DockThemeId } from "./theme";

/** The mode of the app's current theme, as the theme engine leaves it on the page. */
function readAppMode(): Theme["mode"] {
  return document.documentElement.style.colorScheme.includes("light") ? "light" : "dark";
}

/** The app theme's mode, kept current when Settings changes the theme while the dock runs. */
export function useAppMode(): Theme["mode"] {
  const [mode, setMode] = useState(readAppMode);
  useEffect(() => {
    const observer = new MutationObserver(() => setMode(readAppMode()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme"] });
    return () => observer.disconnect();
  }, []);
  return mode;
}

/**
 * Puts the theme's palette on the dock root, or lets the root inherit the app's theme when the theme has none
 * (see `paletteFor`). Runs before paint, so the first frame is already in the right colours.
 */
export function useDockPalette(root: RefObject<HTMLElement | null>, theme: DockThemeId, mounted: boolean): Theme["mode"] {
  const tone = useDockStore((s) => s.backdrop.tone);
  const appMode = useAppMode();
  const palette = paletteFor(theme, tone, appMode);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    if (palette) applyTheme(palette, el);
    else clearTheme(el);
  }, [root, palette, mounted]);
  return palette?.mode ?? appMode;
}
