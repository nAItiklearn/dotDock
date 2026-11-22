import { useEffect, useState } from "react";
import { MAGNIFICATION_LIMITS } from "../geometry";
import { useDockStore } from "../store";
import { panelShownAtStart, togglesPanel } from "./panelKey";
import type { EffectsChoice } from "../effects";
import { TILE_IDS, type TileId } from "../model";
import { DOCK_THEMES, type DockThemeId } from "../theme";
import type { FeedName, TileIssue } from "../tiles/ui-types";
import { dev } from "./devBackend";
import { devTiles, sampleAgenda, sampleMeeting } from "./devTiles";
import { WINDOWS } from "./fixtures";
import { DEV_WALLPAPERS, isWallpaperId, setWallpaper, useDevWallpaper, type WallpaperMode } from "./wallpapers";
import { seedFocus, seedReminders, type FocusSeed } from "./seeds";

/** DEV ONLY. Fixture controls for the dock. Never part of the production build. */

const EFFECTS: readonly EffectsChoice[] = ["auto", "full", "lite"];
const FEEDS: readonly FeedName[] = ["contacts", "meeting", "stopwatch", "mic", "hydration", "agenda", "audio"];
const ISSUES: readonly (TileIssue | "none")[] = ["none", "unsupported", "no-device", "offline", "error", "needs-setup"];
const FOCUS_SEEDS: readonly FocusSeed[] = ["idle", "running", "paused", "break", "other-timer"];
const MINUTE_MS = 60_000;
const NEW_APPS = ["Lumen Notes", "Tide Weather", "Grain Recorder"] as const;

/** Hidden until the backquote key (see `panelKey.ts`): the dock itself is the way to try every feature. */
export function DevPanel() {
  const [shown, setShown] = useState(() => panelShownAtStart(location.search));
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (togglesPanel({ code: e.code, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, typing })) setShown((now) => !now);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return shown ? <Fixture /> : null;
}

function Fixture() {
  const settings = useDockStore((s) => s.settings);
  const choice = useDockStore((s) => s.effectsChoice);
  const themeChoice = useDockStore((s) => s.themeChoice);
  const backdrop = useDockStore((s) => s.backdrop);
  const [open, setOpen] = useState(true);
  const [installed, setInstalled] = useState(0);
  const [feed, setFeed] = useState<FeedName>("contacts");
  const wallpaper = useDevWallpaper();
  const set = dev.patchSettings;
  const toggleTile = (id: TileId, on: boolean): void => set({ tiles: on ? [...settings.tiles, id] : settings.tiles.filter((tile) => tile !== id) });

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
            icon size {settings.iconSize}
            <input type="range" min={32} max={80} value={settings.iconSize} onChange={(e) => set({ iconSize: Number(e.target.value) })} />
          </label>
          <label>
            magnification {settings.magnification.toFixed(2)}
            <input type="range" min={1} max={MAGNIFICATION_LIMITS.max} step={0.05} value={settings.magnification} onChange={(e) => set({ magnification: Number(e.target.value) })} />
          </label>
          <label>
            effects
            <select value={choice} onChange={(e) => useDockStore.getState().setEffectsChoice(e.target.value as EffectsChoice)}>
              {EFFECTS.map((tier) => (
                <option key={tier}>{tier}</option>
              ))}
            </select>
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

          <label>
            wallpaper
            <select value={wallpaper.id} onChange={(e) => isWallpaperId(e.target.value) && setWallpaper({ id: e.target.value })}>
              {DEV_WALLPAPERS.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            wallpaper tone
            <select value={wallpaper.mode} onChange={(e) => setWallpaper({ mode: e.target.value as WallpaperMode })}>
              <option>dark</option>
              <option>light</option>
            </select>
          </label>
          <label>
            theme
            <select value={themeChoice} onChange={(e) => useDockStore.getState().setThemeChoice(e.target.value as DockThemeId)}>
              {DOCK_THEMES.map((id) => (
                <option key={id}>{id}</option>
              ))}
            </select>
          </label>
          <label className="dev__check">
            <input type="checkbox" checked={backdrop.available} onChange={(e) => dev.backdrop({ ...backdrop, available: e.target.checked })} />
            native blur available
          </label>
          <label className="dev__check">
            <input type="checkbox" checked={backdrop.saver} onChange={(e) => dev.backdrop({ ...backdrop, saver: e.target.checked })} />
            battery saver
          </label>

          <fieldset className="dev__tiles">
            <legend>tiles on the dock</legend>
            {TILE_IDS.map((id) => (
              <label key={id} className="dev__check">
                <input type="checkbox" checked={settings.tiles.includes(id)} onChange={(e) => toggleTile(id, e.target.checked)} />
                {id}
              </label>
            ))}
            <div className="dev__row">
              <button type="button" onClick={() => set({ tiles: [...TILE_IDS] })}>
                all
              </button>
              <button type="button" onClick={() => set({ tiles: [] })}>
                none
              </button>
            </div>
          </fieldset>
          <label>
            feed state
            <select value={feed} onChange={(e) => setFeed(e.target.value as FeedName)}>
              {FEEDS.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          <div className="dev__row">
            {ISSUES.map((issue) => (
              <button key={issue} type="button" onClick={() => devTiles.setIssue(feed, issue === "none" ? null : issue)}>
                {issue}
              </button>
            ))}
          </div>
          <div className="dev__row">
            <button type="button" onClick={() => devTiles.failNext("The app could not be opened.")}>
              fail next tile command
            </button>
            <button type="button" onClick={() => devTiles.outside.volume(0.12)}>
              volume key: 12 %
            </button>
            <button type="button" onClick={() => devTiles.outside.micMuted(true)}>
              mic muted elsewhere
            </button>
            <button type="button" onClick={() => devTiles.outside.devices(1)}>
              one output only
            </button>
          </div>
          <div className="dev__row">
            <button type="button" onClick={() => devTiles.setMeeting(sampleMeeting(Date.now(), 4 * MINUTE_MS))}>
              meeting in 4 min
            </button>
            <button type="button" onClick={() => devTiles.setMeeting(sampleMeeting(Date.now(), 2 * MINUTE_MS, null))}>
              meeting, no link
            </button>
            <button type="button" onClick={() => devTiles.setMeeting(null)}>
              no meeting
            </button>
            <button type="button" onClick={() => devTiles.setAgenda({ ...sampleAgenda(Date.now()), events: [] })}>
              empty day
            </button>
            <button type="button" onClick={() => devTiles.setContacts({ contacts: [] })}>
              no contacts
            </button>
          </div>
          <div className="dev__row">
            <button type="button" onClick={seedReminders}>
              seed reminders
            </button>
            {FOCUS_SEEDS.map((seed) => (
              <button key={seed} type="button" onClick={() => seedFocus(seed)}>
                focus: {seed}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
