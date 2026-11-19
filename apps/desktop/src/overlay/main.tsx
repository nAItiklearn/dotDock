import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../design-system/tokens.css";
import { displayFromLocation, initApp } from "../lib/state/app";
import { applyCurrentAppearance } from "../lib/theme/useAppearance";
import { connectProviders, isTauri } from "../providers/bridge";
import { widgetCatalog } from "./catalog";
import { Overlay } from "./Overlay";
import { syncTypingFocus } from "./typingFocus";

const params = new URLSearchParams(location.search);
// `?theme=<id>` pins a theme for design previews and screenshots; normal runs follow Settings.
const pinnedTheme = params.get("theme");
const app = initApp({ catalog: widgetCatalog, ...displayFromLocation(location.search) });

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
});
