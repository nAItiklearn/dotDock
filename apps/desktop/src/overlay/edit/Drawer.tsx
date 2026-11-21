import { useState } from "react";
import type { GridMetrics } from "../../lib/layout/grid";
import type { JsonValue } from "../../lib/model/json";
import type { WidgetInfo } from "../../lib/model/types";
import { fieldsForSize, normalizeConfig } from "../../widgets/configSchema";
import { getApp } from "../../lib/state/app";
import { useLayoutStore, useSettingsStore } from "../../lib/state/hooks";
import { Button, IconButton, Segmented } from "../../lib/ui/controls";
import { ConfigForm } from "../../lib/ui/ConfigForm";
import { SizePicker } from "../../lib/ui/SizePicker";
import { widgetCatalog } from "../catalog";
import { announce, editUi, useEditUi, type DrawerTab } from "../editUi";
import { addOrigin, removeWithExit } from "../directActions";
import { WidgetPreview } from "../WidgetPreview";

/** Drawer width less the body, card and stage padding: a preview never makes the card scroll sideways. */
const PREVIEW_MAX_WIDTH = 248;
const PREVIEW_MAX_HEIGHT = 112;

const TABS: readonly { value: DrawerTab; label: string }[] = [
  { value: "add", label: "Add" },
  { value: "selected", label: "Selected" },
];

function GalleryCard({ meta, metrics }: { readonly meta: WidgetInfo; readonly metrics: GridMetrics }) {
  const [sizeId, setSizeId] = useState<string>(meta.sizes[0]?.id ?? "m");
  const add = (): void => {
    const at = editUi.getState().addAt;
    const near = addOrigin(at, meta.sizes.find((s) => s.id === sizeId));
    const result = getApp().layout.getState().addWidget(meta.id, sizeId, near);
    if (result.ok) announce(`${meta.name} added`);
  };
  return (
    <li className="gallery-card">
      <div className="gallery-card__stage">
        <WidgetPreview meta={meta} sizeId={sizeId} metrics={metrics} maxWidth={PREVIEW_MAX_WIDTH} maxHeight={PREVIEW_MAX_HEIGHT} />
      </div>
      <div className="gallery-card__body">
        <div className="gallery-card__text">
          <span className="gallery-card__name">{meta.name}</span>
          <span className="gallery-card__desc">{meta.description}</span>
        </div>
        <div className="gallery-card__actions">
          {meta.sizes.length > 1 ? (
            <SizePicker label={`${meta.name} size`} sizes={meta.sizes} value={sizeId} onChange={setSizeId} />
          ) : (
            <span />
          )}
          <Button icon="plus" onClick={add} aria-label={`Add ${meta.name}`}>
            Add
          </Button>
        </div>
      </div>
    </li>
  );
}

function AddTab({ metrics }: { readonly metrics: GridMetrics }) {
  return (
    <ul className="gallery" aria-label="Widgets you can add">
      {widgetCatalog.list().map((meta) => (
        <GalleryCard key={meta.id} meta={meta} metrics={metrics} />
      ))}
    </ul>
  );
}

function SelectedTab() {
  const layout = getApp().layout;
  const selected = useLayoutStore((s) => s.placements.find((p) => p.id === s.selectedId));
  const meta = selected ? widgetCatalog.get(selected.widget) : undefined;
  if (!selected || !meta) {
    return (
      <div className="drawer__empty">
        <span className="caps">Nothing selected</span>
        <p>Click a widget to change its size and options.</p>
      </div>
    );
  }
  const sizeId = (meta.sizes.find((s) => s.id === selected.size) ?? meta.sizes[0])?.id ?? "m";
  const config = normalizeConfig(meta.settingsSchema, selected.config);
  const fields = fieldsForSize(meta.settingsSchema, sizeId, config);
  return (
    <div className="selected">
      <div className="selected__head">
        <span className="gallery-card__name">{meta.name}</span>
        <span className="caps">{selected.id}</span>
      </div>
      {meta.sizes.length > 1 ? (
        <div className="ui-form__row">
          <span className="ui-form__label">Size</span>
          <SizePicker label="Size" sizes={meta.sizes} value={sizeId} onChange={(next) => layout.getState().resizeTo(selected.id, next)} />
        </div>
      ) : null}
      {fields.length > 0 ? (
        <ConfigForm
          schema={meta.settingsSchema}
          size={sizeId}
          config={config}
          onChange={(key: string, value: JsonValue) => layout.getState().patchConfig(selected.id, { [key]: value })}
        />
      ) : null}
      {meta.sizes.length < 2 && fields.length === 0 ? <p className="drawer__note">This widget has nothing to adjust.</p> : null}
      <div className="selected__actions">
        <Button icon="duplicate" onClick={() => layout.getState().duplicate(selected.id)}>
          Duplicate
        </Button>
        <Button variant="danger" icon="trash" onClick={() => void removeWithExit(layout, selected.id, meta.name)}>
          Remove
        </Button>
      </div>
    </div>
  );
}

/** Slide-in panel: gallery of widgets to add, and the options of the selected widget. */
export function Drawer({ metrics }: { readonly metrics: GridMetrics }) {
  const tab = useEditUi((s) => s.drawerTab);
  const locked = useSettingsStore((s) => s.settings.layout.locked);
  return (
    <aside id="edit-drawer" className="drawer" data-hit aria-label="Widgets">
      <div className="drawer__panel">
        <header className="drawer__head">
          <Segmented label="Panel" value={tab} options={TABS} onChange={(next) => editUi.setState({ drawerTab: next })} />
          <IconButton icon="close" label="Close panel" onClick={() => editUi.setState({ drawerOpen: false, addAt: null })} />
        </header>
        <div className="drawer__body">
          {locked ? (
            <div className="drawer__empty">
              <span className="caps">Layout locked</span>
              <p>Unlock the layout to add, remove or change widgets.</p>
            </div>
          ) : tab === "add" ? (
            <AddTab metrics={metrics} />
          ) : (
            <SelectedTab />
          )}
        </div>
      </div>
    </aside>
  );
}
