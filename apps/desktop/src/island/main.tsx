import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "../design-system/tokens.css";
import { applyTheme, themeById } from "../design-system/themes";
import { isTauri } from "../providers/bridge";
import { actions, connectIsland } from "./bridge";
import { warmTokenFormats } from "./format";
import { Island } from "./Island";
import { primeActiveIsland } from "./prime";
import { useIslandStore } from "./store";

applyTheme(themeById(new URLSearchParams(location.search).get("theme") ?? "obsidian"));

const container = document.getElementById("root");
if (!container) throw new Error("island.html is missing #root");
const root = createRoot(container);

async function boot(): Promise<void> {
  // The fixture panel exists only in `vite dev` in a plain browser; the build removes this branch and the chunk.
  const dev = import.meta.env.DEV && !isTauri() ? await import("./dev/mountDevPanel") : null;
  dev?.installDevBackend();
  warmTokenFormats();
  await document.fonts.ready;
  flushSync(() => root.render(<StrictMode><Island /></StrictMode>));
  dev?.mountDevPanel();
  await connectIsland();
  actions.ready();
  primeActiveIsland(useIslandStore.getState().settings);
}

boot().catch((err: unknown) => console.error("island failed to start", err));
