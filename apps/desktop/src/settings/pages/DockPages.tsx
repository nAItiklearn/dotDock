import { useState, type CSSProperties } from "react";
import { AURUM, OBSIDIAN, PAPER, type Theme } from "../../design-system/themes";
import { getNativeApi } from "../../lib/native/api";
import {
  clampIconSize,
  clampMagnification,
  DEFAULT_DOCK_SETTINGS,
  DOCK_ICON_LIMITS,
  DOCK_MAGNIFICATION_LIMITS,
  DOCK_THEMES,
  moveBy,
  pinnedKey,
  pinnedName,
  readDockTheme,
  removeAt,
  saveDockTheme,
  tileName,
  tilesNotOnDock,
  type DockAppName,
  type DockSettings,
  type DockThemeId,
} from "../../lib/native/dock";
import { Button, IconButton, SelectField, Slider, Switch } from "../../lib/ui/controls";
import { NativeGate, useNativeResource, useNativeWrite, type NativeResource } from "../ui/native";
import { PageHeader, Row, Section } from "../ui/layout";

/** The bundled windswept-grass wallpaper every dock preview sits on, as the dock's own harness does. */
export const PREVIEW_WALLPAPER = "/wallpaper-thumbs/meadow-dots-dark.jpg";

const DOCK_OFFERS = ["Choose what is on the dock, and in what order.", "Change its size, magnification and auto-hide."];

/** The dock's settings, changed on screen at once and then written to the dock's own store. */
function useDockSettings(): { readonly resource: NativeResource<DockSettings>; readonly change: (next: DockSettings) => void } {
  const resource = useNativeResource((api) => api.dock.get());
  const write = useNativeWrite(resource, "The dock didn't take that");
  return { resource, change: (next) => write(() => next, () => getNativeApi().dock.set(next)) };
}

// ------------------------------------------------------------------- reorderable list

interface OrderedListProps<T> {
  readonly items: readonly T[];
  readonly keyOf: (item: T) => string;
  readonly nameOf: (item: T) => string;
  readonly onChange: (next: readonly T[]) => void;
  readonly empty: string;
}

/** A list the user reorders with the arrows and trims with the bin, each change written straight away. */
function OrderedList<T>({ items, keyOf, nameOf, onChange, empty }: OrderedListProps<T>) {
  if (items.length === 0) return <p className="empty row--block">{empty}</p>;
  return (
    <ul className="list ordered">
      {items.map((item, index) => {
        const name = nameOf(item);
        return (
          <li key={keyOf(item)} className="list__row ordered__row">
            <span className="ordered__index tabular" aria-hidden="true">
              {index + 1}
            </span>
            <span className="list__main">
              <span className="list__title">{name}</span>
            </span>
            <span className="list__actions">
              <IconButton icon="up" label={`Move ${name} left`} disabled={index === 0} onClick={() => onChange(moveBy(items, index, -1))} />
              <IconButton
                icon="down"
                label={`Move ${name} right`}
                disabled={index === items.length - 1}
                onClick={() => onChange(moveBy(items, index, 1))}
              />
              <IconButton icon="trash" tone="danger" label={`Remove ${name} from the dock`} onClick={() => onChange(removeAt(items, index))} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** A picker of what is not on the dock yet, and the button that adds it at the end. */
function AddRow({ id, label, options, onAdd }: { readonly id: string; readonly label: string; readonly options: readonly { value: string; label: string }[]; readonly onAdd: (value: string) => void }) {
  const [picked, setPicked] = useState("");
  const value = options.some((o) => o.value === picked) ? picked : (options[0]?.value ?? "");
  return (
    <Row id={id} label={label} description={options.length === 0 ? "Everything there is to add is on the dock already." : "Added at the end; move it with the arrows."}>
      {options.length > 0 ? (
        <>
          <SelectField label={label} value={value} options={options} onChange={setPicked} />
          <Button icon="plus" onClick={() => onAdd(value)}>
            Add
          </Button>
        </>
      ) : null}
    </Row>
  );
}

// --------------------------------------------------------------------------- items

function ItemsBody({ settings, apps, change }: { readonly settings: DockSettings; readonly apps: readonly DockAppName[]; readonly change: (next: DockSettings) => void }) {
  const pinnedApps = new Set(settings.pinned.flatMap((p) => (p.kind === "app" ? [p.id] : [])));
  const addable = apps.filter((a) => !pinnedApps.has(a.id)).map((a) => ({ value: a.id, label: a.name }));
  return (
    <>
      <Section title="On the dock" description="Apps and stacks, left to right. Running apps that are not kept here appear after them while they run.">
        <OrderedList
          items={settings.pinned}
          keyOf={pinnedKey}
          nameOf={(item) => pinnedName(item, apps)}
          onChange={(pinned) => change({ ...settings, pinned })}
          empty="Nothing is kept on the dock. Add an app below, or right-click one on the dock and keep it there."
        />
      </Section>
      <Section title="Add">
        <AddRow
          id="dock-add-app"
          label="Keep an app on the dock"
          options={addable}
          onAdd={(id) => change({ ...settings, pinned: [...settings.pinned, { kind: "app", id }] })}
        />
      </Section>
    </>
  );
}

export function DockItemsPage() {
  const { resource, change } = useDockSettings();
  const apps = useNativeResource((api) => api.dock.apps());
  const names = apps.state.status === "ready" ? apps.state.data : [];
  return (
    <>
      <PageHeader page="dock-items" />
      <NativeGate resource={resource} icon="dock" offers={DOCK_OFFERS}>
        {(settings) => <ItemsBody settings={settings} apps={names} change={change} />}
      </NativeGate>
    </>
  );
}

// --------------------------------------------------------------------------- tiles

export function DockTilesPage() {
  const { resource, change } = useDockSettings();
  return (
    <>
      <PageHeader page="dock-tiles" />
      <NativeGate resource={resource} icon="widgets" offers={["Choose the live tiles at the end of the dock, and their order."]}>
        {(settings) => (
          <>
            <Section title="Live tiles" description="Shown after the apps, left to right. Click one on the dock to open it.">
              <OrderedList
                items={settings.tiles}
                keyOf={(id) => id}
                nameOf={tileName}
                onChange={(tiles) => change({ ...settings, tiles })}
                empty="No tiles on the dock. Add one below, or from the dock's own widget gallery."
              />
            </Section>
            <Section title="Add">
              <AddRow
                id="dock-add-tile"
                label="Add a tile"
                options={tilesNotOnDock(settings.tiles).map((id) => ({ value: id, label: tileName(id) }))}
                onAdd={(id) => change({ ...settings, tiles: [...settings.tiles, id] })}
              />
            </Section>
          </>
        )}
      </NativeGate>
    </>
  );
}

// ---------------------------------------------------------------------- appearance

export const DOCK_THEME_META: Readonly<Record<DockThemeId, { readonly name: string; readonly line: string }>> = {
  glass: { name: "Glass", line: "Blurs the desktop behind a tinted bar." },
  "glass-lite": { name: "Glass lite", line: "The same bar, semi-opaque and without blur." },
  obsidian: { name: "Obsidian", line: "Solid, in the dark home-screen palette." },
  paper: { name: "Paper", line: "Solid, in the light home-screen palette." },
  aurum: { name: "Aurum", line: "Solid, dark with gold." },
  minimal: { name: "Minimal", line: "Icons only, no bar." },
};

/** Discs on the miniature: as many as a short dock, then a divider and one tile. */
const PREVIEW_ICONS = 5;

/** The palette a theme draws with over the dark grass: the solid ones their own, the rest Obsidian (`paletteFor`). */
export function previewPalette(theme: DockThemeId): Theme {
  return theme === "paper" ? PAPER : theme === "aurum" ? AURUM : OBSIDIAN;
}

/** A miniature of the dock drawn in one theme, over the grass wallpaper. */
export function DockPreview({ theme }: { readonly theme: DockThemeId }) {
  const { colors } = previewPalette(theme);
  const palette = {
    "--pv-solid": colors.bg,
    "--pv-disc": colors.surface2,
    "--pv-edge": colors.border,
    "--pv-accent": colors.accent,
    "--pv-text": colors.text,
  } as CSSProperties;
  return (
    <span className="dock-preview" style={{ backgroundImage: `url(${PREVIEW_WALLPAPER})` }} aria-hidden="true">
      <span className="dock-preview__bar" data-dock-theme={theme} style={palette}>
        {Array.from({ length: PREVIEW_ICONS }, (_, i) => (
          <span key={i} className="dock-preview__icon" />
        ))}
        <span className="dock-preview__divider" />
        <span className="dock-preview__tile" />
      </span>
    </span>
  );
}

export function DockAppearancePage() {
  const [theme, setTheme] = useState<DockThemeId>(() => readDockTheme());
  const choose = (next: DockThemeId): void => {
    setTheme(next);
    saveDockTheme(next);
  };
  return (
    <>
      <PageHeader page="dock-look" />
      <Section title="Dock theme" description="Each one is shown over the Wind Meadow wallpaper. Glass falls back to Glass lite when Windows has transparency effects off.">
        <div className="row row--block" data-setting-id="dock-theme">
          <div className="dock-themes" role="radiogroup" aria-label="Dock theme">
            {DOCK_THEMES.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={id === theme}
                className={`dock-theme${id === theme ? " is-selected" : ""}`}
                onClick={() => choose(id)}
              >
                <DockPreview theme={id} />
                <span className="dock-theme__name">{DOCK_THEME_META[id].name}</span>
                <span className="dock-theme__line">{DOCK_THEME_META[id].line}</span>
              </button>
            ))}
          </div>
        </div>
      </Section>
    </>
  );
}

// ----------------------------------------------------------------------- behaviour

export const magnificationText = (factor: number): string => (factor <= DOCK_MAGNIFICATION_LIMITS.min ? "Off" : `${Math.round(factor * 100)}%`);

function BehaviourBody({ settings, change }: { readonly settings: DockSettings; readonly change: (next: DockSettings) => void }) {
  return (
    <>
      <Section title="Size">
        <Row
          id="dock-icon-size"
          label="Icon size"
          description="At 100 % display scaling."
          isDefault={settings.iconSize === DEFAULT_DOCK_SETTINGS.iconSize}
          onReset={() => change({ ...settings, iconSize: DEFAULT_DOCK_SETTINGS.iconSize })}
        >
          <span className="control-with-value">
            <Slider
              label="Icon size"
              value={settings.iconSize}
              min={DOCK_ICON_LIMITS.min}
              max={DOCK_ICON_LIMITS.max}
              step={DOCK_ICON_LIMITS.step}
              valueText={`${settings.iconSize} pixels`}
              onChange={(v) => change({ ...settings, iconSize: clampIconSize(v) })}
            />
            <span className="control-value tabular">{settings.iconSize} px</span>
          </span>
        </Row>
        <Row
          id="dock-magnification"
          label="Magnification"
          description="How much icons grow under the pointer."
          isDefault={settings.magnification === DEFAULT_DOCK_SETTINGS.magnification}
          onReset={() => change({ ...settings, magnification: DEFAULT_DOCK_SETTINGS.magnification })}
        >
          <span className="control-with-value">
            <Slider
              label="Magnification"
              value={settings.magnification}
              min={DOCK_MAGNIFICATION_LIMITS.min}
              max={DOCK_MAGNIFICATION_LIMITS.max}
              step={DOCK_MAGNIFICATION_LIMITS.step}
              valueText={magnificationText(settings.magnification)}
              onChange={(v) => change({ ...settings, magnification: clampMagnification(v) })}
            />
            <span className="control-value tabular">{magnificationText(settings.magnification)}</span>
          </span>
        </Row>
      </Section>
      <Section title="Hiding">
        <Row id="dock-auto-hide" label="Hide automatically" description="Slides away until the pointer reaches the bottom of the screen.">
          <Switch label="Hide the dock automatically" checked={settings.autoHide} onChange={(autoHide) => change({ ...settings, autoHide })} />
        </Row>
      </Section>
    </>
  );
}

export function DockBehaviourPage() {
  const { resource, change } = useDockSettings();
  return (
    <>
      <PageHeader page="dock-behaviour" />
      <NativeGate resource={resource} icon="dock" offers={DOCK_OFFERS}>
        {(settings) => <BehaviourBody settings={settings} change={change} />}
      </NativeGate>
    </>
  );
}

// ------------------------------------------------------------------------- taskbar

export function DockTaskbarPage() {
  const { resource, change } = useDockSettings();
  return (
    <>
      <PageHeader page="dock-taskbar" />
      <NativeGate resource={resource} icon="dock" offers={["Keep maximised windows clear of the dock."]}>
        {(settings) => (
          <Section title="Windows">
            <Row
              id="dock-reserve-space"
              label="Keep windows clear of the dock"
              description="Maximised windows stop at the dock instead of going under it, as they do with the taskbar."
            >
              <Switch label="Keep windows clear of the dock" checked={settings.reserveSpace} onChange={(reserveSpace) => change({ ...settings, reserveSpace })} />
            </Row>
          </Section>
        )}
      </NativeGate>
    </>
  );
}
