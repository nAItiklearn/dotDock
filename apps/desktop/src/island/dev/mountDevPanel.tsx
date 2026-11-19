import { createRoot } from "react-dom/client";
import { actions, setBackend } from "../bridge";
import { useIslandStore } from "../store";
import { DevPanel } from "./DevPanel";
import { devBackend } from "./devBackend";

/** DEV ONLY. Entry for the fixture panel; main.tsx imports it only under `import.meta.env.DEV`. */

/** Replaces the missing core with fixtures. Must run before the island connects. */
export function installDevBackend(): void {
  setBackend(devBackend);
}

/** Frames #root as the real 520 x 240 window and mounts the panel next to it. `window.island` exposes the store to devtools. */
export function mountDevPanel(): void {
  document.getElementById("root")?.classList.add("dev-frame");
  const host = document.createElement("div");
  host.id = "dev-panel";
  document.body.append(host);
  createRoot(host).render(<DevPanel />);
  Object.assign(window, { island: { store: useIslandStore, actions } });
}
