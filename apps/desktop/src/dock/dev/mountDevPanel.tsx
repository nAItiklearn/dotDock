import { createRoot } from "react-dom/client";
import { useProviderStore } from "../../providers/store";
import { actions, setBackend } from "../bridge";
import { useDockStore } from "../store";
import { DevPanel } from "./DevPanel";
import { dev, devBackend } from "./devBackend";
import { sampleIcon } from "./sampleIcons";
import "./DevPanel.css";

/** DEV ONLY. Entry for the fixture panel; main.tsx imports it only under `import.meta.env.DEV`. */

/** Replaces the missing core with fixtures. Must run before the dock connects. */
export function installDevBackend(): void {
  setBackend(devBackend);
}

const BYTES_PER_GIB = 1024 ** 3;

/** Sample provider data for the tiles: a track, memory use, a battery. Clearly the fixture's, never the product's. */
function publishSampleProviders(): void {
  const { publish } = useProviderStore.getState();
  publish("media", {
    title: "Slow Afternoon",
    artist: "Northwind Quartet",
    album: "Fixture",
    artwork: sampleIcon("Slow Afternoon"),
    positionSec: 62,
    durationSec: 241,
    playing: true,
    canSeek: true,
    canNext: true,
    canPrev: true,
  });
  publish("system", {
    memTotalBytes: 16 * BYTES_PER_GIB,
    memUsedBytes: 9.6 * BYTES_PER_GIB,
    cpuPercent: 18,
    disks: [],
  });
  publish("battery", { percent: 72, charging: false, pluggedIn: false, secondsRemaining: 9000 });
}

/** Paints a wallpaper behind the transparent dock window and mounts the panel. `window.dockDev` exposes the fixture to devtools. */
export function mountDevPanel(): void {
  const params = new URLSearchParams(location.search);
  const dark = getComputedStyle(document.documentElement).colorScheme.includes("dark");
  const wallpaper = params.get("wall") ?? (dark ? "louver-silver-dark" : "soft-mono-light");
  const backdrop = document.createElement("div");
  backdrop.className = "dev-backdrop";
  backdrop.style.backgroundImage = `url(/wallpaper-thumbs/${wallpaper}.jpg)`;
  document.body.prepend(backdrop);
  if (params.get("sample") !== "0") publishSampleProviders();
  Object.assign(window, { dockDev: { dev, store: useDockStore, actions } });
  if (params.get("panel") === "0") return;
  const host = document.createElement("div");
  host.id = "dev-panel";
  document.body.append(host);
  createRoot(host).render(<DevPanel />);
}
