import { StrictMode } from "react";
import { listen } from "@tauri-apps/api/event";
import { createRoot } from "react-dom/client";
import "../design-system/tokens.css";
import { getNativeApi } from "../lib/native/api";
import { displayFromLocation, initApp } from "../lib/state/app";
import { sampleImage } from "../lib/theme/imageSample";
import { EVENT_WALLPAPER_CHANGED, followWallpaper } from "../lib/theme/wallpaperFollow";
import { applyCurrentAppearance } from "../lib/theme/useAppearance";
import { connectProviders, isTauri } from "../providers/bridge";
import { widgetCatalog } from "./catalog";
import { Overlay } from "./Overlay";
import { syncTypingFocus } from "./typingFocus";

const params = new URLSearchParams(location.search);
// `?theme=<id>` pins a theme for design previews and screenshots; normal runs follow Settings.
const pinnedTheme = params.get("theme");
const display = displayFromLocation(location.search);
const app = initApp({ catalog: widgetCatalog, ...display });

const root = document.getElementById("root");
if (!root) throw new Error("overlay.html is missing #root");

// Paint only once fonts and the saved settings are in, so the first frame is final: right theme,
// right layout, no text reflow and no flash of the wrong state on boot.
void Promise.all([document.fonts.ready, app.start()]).then(() => {
  applyCurrentAppearance(pinnedTheme);
  createRoot(root).render(
    <StrictMode>
      {isTauri() ? null : <div className="preview-backdrop" />}
      <Overlay forceThemeId={pinnedTheme} />
    </StrictMode>,
  );
  connectProviders().catch((err: unknown) => console.error("providers failed to connect", err));
  syncTypingFocus();
  // The home screen follows the Windows wallpaper for every window: the dock and Settings read the same settings.
  if (isTauri()) {
    const follow = (): void => {
      followWallpaper(app.settings, () => getNativeApi().wallpapers.announcedImage(), sampleImage).catch((err: unknown) =>
        console.error("following the wallpaper failed", err),
      );
    };
    void listen(EVENT_WALLPAPER_CHANGED, follow);
    // Once at start, from the primary display only: a fresh install makes its theme from the wallpaper it finds, and a
    // wallpaper changed while dotDock was not running is picked up. A theme chosen by hand is never read or replaced.
    if (display.isPrimary) follow();
  }
});
