import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../design-system/tokens.css";
import { applyTheme, themeById } from "../design-system/themes";
import { connectProviders, isTauri } from "../providers/bridge";
import { Overlay } from "./Overlay";
import { DEFAULT_LAYOUT } from "./layout";
import { syncTypingFocus } from "./typingFocus";

const params = new URLSearchParams(location.search);
applyTheme(themeById(params.get("theme") ?? "obsidian"));

const root = document.getElementById("root");
if (!root) throw new Error("overlay.html is missing #root");

// Paint only once the fonts are in, so the first frame is final (no text reflow on boot).
void document.fonts.ready.then(() => {
  createRoot(root).render(
    <StrictMode>
      {isTauri() ? null : <div className="preview-backdrop" />}
      <Overlay layout={DEFAULT_LAYOUT} />
    </StrictMode>,
  );
  connectProviders().catch((err: unknown) => console.error("providers failed to connect", err));
  syncTypingFocus();
});
