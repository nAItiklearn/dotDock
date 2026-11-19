import { useEffect, useLayoutEffect, useState } from "react";
import { getApp } from "../state/app";
import { useSettingsStore } from "../state/hooks";
import { applyAppearance, findTheme, msUntilNextSwitch, resolveThemeId } from "./appearance";

const DARK_QUERY = "(prefers-color-scheme: dark)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = (): void => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/**
 * Applies the stored appearance once, outside React. Entry files call it before the first render so
 * the very first frame already has the right theme and nothing flashes on boot.
 */
export function applyCurrentAppearance(forceThemeId?: string | null): void {
  const app = getApp();
  const { settings, customThemes } = app.settings.getState();
  const themeId = forceThemeId ?? resolveThemeId(settings.theme, new Date(), window.matchMedia(DARK_QUERY).matches);
  applyAppearance(findTheme(themeId, customThemes), settings, {
    monitorId: app.monitorId,
    osReducesMotion: window.matchMedia(REDUCED_MOTION_QUERY).matches,
  });
}

/**
 * Keeps the page's CSS tokens in step with settings: theme (including light/dark by OS or schedule),
 * corner radius, spacing, motion and font. Mount once, at the root of each window.
 *
 * `forceThemeId` pins a theme regardless of settings; used by design previews.
 */
export function useAppearance(forceThemeId?: string | null): void {
  const settings = useSettingsStore((s) => s.settings);
  const customThemes = useSettingsStore((s) => s.customThemes);
  const systemDark = useMediaQuery(DARK_QUERY);
  const osReducesMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const [scheduleTick, setScheduleTick] = useState(0);
  const { monitorId } = getApp();

  // Wake exactly when the schedule flips, instead of polling.
  useEffect(() => {
    const wait = msUntilNextSwitch(settings.theme, new Date());
    if (wait === null) return undefined;
    const timer = setTimeout(() => setScheduleTick((n) => n + 1), wait + 50);
    return () => clearTimeout(timer);
  }, [settings.theme, scheduleTick]);

  useLayoutEffect(() => {
    const themeId = forceThemeId ?? resolveThemeId(settings.theme, new Date(), systemDark);
    applyAppearance(findTheme(themeId, customThemes), settings, { monitorId, osReducesMotion });
  }, [settings, customThemes, systemDark, osReducesMotion, scheduleTick, monitorId, forceThemeId]);
}
