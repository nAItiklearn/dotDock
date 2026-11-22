import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "../design-system/tokens.css";
import type { WidgetCatalog } from "../lib/model/types";
import { initApp } from "../lib/state/app";
import { applyCurrentAppearance, useAppearance } from "../lib/theme/useAppearance";
import { connectProviders, isTauri } from "../providers/bridge";
import { connectDock } from "./bridge";
import { Dock } from "./Dock";

// The dock has no widgets. It borrows the app's settings store for the theme and nothing else: the layout is never loaded.
const NO_WIDGETS: WidgetCatalog = { list: () => [], get: () => undefined };

// `?theme=<id>` pins a theme for design previews and screenshots; normal runs follow Settings.
const pinnedTheme = new URLSearchParams(location.search).get("theme");
const app = initApp({ catalog: NO_WIDGETS });

const container = document.getElementById("root");
if (!container) throw new Error("dock.html is missing #root");
const root = createRoot(container);

/** Keeps the tokens in step with Settings while the dock runs. */
function Appearance() {
  useAppearance(pinnedTheme);
  return null;
}

async function boot(): Promise<void> {
  // The fixture exists only in `vite dev` in a plain browser (or a build made with VITE_DOCK_FIXTURE=1 for performance
  // measurements, which is never shipped); the release build removes this branch and the chunk.
  const dev = (import.meta.env.DEV || import.meta.env.VITE_DOCK_FIXTURE === "1") && !isTauri() ? await import("./dev/mountDevPanel") : null;
  dev?.installDevBackend();
  await Promise.all([document.fonts.ready, app.settings.getState().init()]);
  applyCurrentAppearance(pinnedTheme);
  await connectDock();
  flushSync(() =>
    root.render(
      <StrictMode>
        <Appearance />
        <Dock />
      </StrictMode>,
    ),
  );
  dev?.mountDevPanel();
  connectProviders().catch((err: unknown) => console.error("providers failed to connect", err));
}

boot().catch((err: unknown) => console.error("dock failed to start", err));
