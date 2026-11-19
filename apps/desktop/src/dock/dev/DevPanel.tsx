import { useState } from "react";
import { useDockStore } from "../store";
import type { DockEdge } from "../protocol";
import { dev } from "./devBackend";
import { WINDOWS } from "./fixtures";

/** DEV ONLY. Fixture controls for the dock. Never part of the production build. */

const EDGES: readonly DockEdge[] = ["bottom", "top", "left", "right"];
const NEW_APPS = ["Lumen Notes", "Tide Weather", "Grain Recorder"] as const;

export function DevPanel() {
  const settings = useDockStore((s) => s.settings);
  const [open, setOpen] = useState(true);
  const [installed, setInstalled] = useState(0);
  const set = dev.patchSettings;

  return (
    <aside className="dev" data-open={open}>
      <header className="dev__head">
        <b>DEV fixture</b>
        <button type="button" onClick={() => setOpen(!open)}>
          {open ? "hide" : "show"}
        </button>
      </header>
      {open ? (
        <div className="dev__body">
          <label>
            edge
            <select value={settings.edge} onChange={(e) => set({ edge: e.target.value as DockEdge })}>
              {EDGES.map((edge) => (
                <option key={edge}>{edge}</option>
              ))}
            </select>
          </label>
          <label>
            icon size {settings.iconSize}
            <input type="range" min={32} max={80} value={settings.iconSize} onChange={(e) => set({ iconSize: Number(e.target.value) })} />
          </label>
          <label>
            magnification {settings.magnification.toFixed(1)}
            <input type="range" min={1} max={2.4} step={0.1} value={settings.magnification} onChange={(e) => set({ magnification: Number(e.target.value) })} />
          </label>
          <label className="dev__check">
            <input type="checkbox" checked={settings.autoHide} onChange={(e) => set({ autoHide: e.target.checked })} />
            auto-hide
          </label>
          <div className="dev__row">
            <button type="button" onClick={() => dev.setWindows(WINDOWS)}>
              restore windows
            </button>
            <button type="button" onClick={() => dev.setWindows([])}>
              no windows
            </button>
          </div>
          <div className="dev__row">
            <button
              type="button"
              onClick={() => {
                dev.install(NEW_APPS[installed % NEW_APPS.length] ?? NEW_APPS[0], "utilities");
                setInstalled(installed + 1);
              }}
            >
              install an app
            </button>
            <button type="button" onClick={() => dev.failNext("The app could not be started.")}>
              fail next command
            </button>
          </div>
          <div className="dev__row">
            <button type="button" onClick={() => useDockStore.getState().setLibrary(true)}>
              library
            </button>
            <button type="button" onClick={() => useDockStore.getState().setEditing(true)}>
              edit mode
            </button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
