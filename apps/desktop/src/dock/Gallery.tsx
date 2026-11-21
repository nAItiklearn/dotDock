import { useEffect, useLayoutEffect, useMemo, useState, type CSSProperties, type DragEvent } from "react";
import { Icon } from "../design-system/Icon";
import { actions } from "./bridge";
import { EmptyGlyph } from "./EmptyGlyph";
import {
  actionOf,
  categoryCounts,
  categoryName,
  filterGallery,
  GALLERY_CATEGORIES,
  GALLERY_MIME,
  galleryItems,
  isAddable,
  placeTile,
  type GalleryCategory,
  type GalleryItem,
} from "./galleryItems";
import { GALLERY, lengthOf, placeBesideDock, shapeOf, type Rect } from "./geometry";
import { appsInCategory, pin, unpin } from "./model";
import { markOpenPainted } from "./openMarks";
import type { OpenGallery } from "./store";
import { useDockStore } from "./store";
import { plural, t } from "./strings";
import { Tile } from "./tiles/Tile";
import type { TileControls } from "./tiles/shell";
import { toneVar } from "./tones";
import { useViewport } from "./useViewport";
import "./panels.css";
import "./tiles/popovers.css";
import "./gallery.css";

const noop = (): void => undefined;
/** Previews are drawn on a copy of the tile that cannot be pressed: they show it, they do not run it. */
const PREVIEW_CONTROLS: TileControls = { editing: true, open: false, onPress: noop, onActivate: noop, onPressKey: noop };

/** Adds an item to the dock, or takes it off. */
export function toggleOnDock(item: GalleryItem): void {
  const { settings } = useDockStore.getState();
  if (item.kind === "tile" && item.tile) {
    const tiles = item.onDock ? settings.tiles.filter((id) => id !== item.tile) : placeTile(settings.tiles, item.tile, settings.tiles.length);
    void actions.updateSettings({ tiles });
  } else if (item.kind === "stack" && item.stack) {
    const entry = { kind: "stack", category: item.stack } as const;
    void actions.updateSettings({ pinned: item.onDock ? unpin(settings.pinned, entry) : pin(settings.pinned, entry) });
  }
}

function Preview({ item }: { readonly item: GalleryItem }) {
  const apps = useDockStore((s) => s.apps);
  const style = { "--d-icon": `${GALLERY.icon}px` } as CSSProperties;
  if (item.kind === "tile" && item.tile) {
    const box: CSSProperties = { ...style, width: lengthOf(item.tile, GALLERY.icon), height: GALLERY.icon };
    return (
      <div className="gcard__tile" style={box} role="img" aria-label={t("gallery.preview", { name: item.name })} inert>
        <Tile id={item.tile} controls={PREVIEW_CONTROLS} />
      </div>
    );
  }
  if (item.kind === "stack" && item.stack) {
    const preview = appsInCategory(apps, item.stack).slice(0, 4);
    return (
      <div className="gcard__stack" style={{ ...style, "--tone": item.tone ? toneVar(item.tone) : "var(--accent)" } as CSSProperties} role="img" aria-label={t("gallery.preview", { name: item.name })}>
        <span className="stack-grid">
          {Array.from({ length: 4 }, (_, i) => {
            const app = preview[i];
            return app ? <img key={app.id} className="art art--mini" src={app.icon} alt="" draggable={false} /> : <i key={i} className="stack-grid__empty" />;
          })}
        </span>
      </div>
    );
  }
  return (
    <div className="gcard__closed" style={style} aria-hidden="true">
      <i />
      <i />
      <i />
    </div>
  );
}

function Card({ item, onDragStart }: { readonly item: GalleryItem; readonly onDragStart: (item: GalleryItem, e: DragEvent) => void }) {
  const note = `gallery-note-${item.key}`;
  const chips =
    item.kind === "tile" && item.tile
      ? [t(`gallery.shape.${shapeOf(item.tile)}`), t(`gallery.action.${actionOf(item.tile)}`)]
      : item.kind === "stack"
        ? [plural("library.count", item.appCount ?? 0)]
        : [];
  return (
    <li className="gcard" data-kind={item.kind} data-on={item.onDock ? "true" : undefined} draggable={item.kind === "tile" && !item.onDock} onDragStart={(e) => onDragStart(item, e)}>
      <div className="gcard__preview">
        <Preview item={item} />
      </div>
      <div className="gcard__body">
        <h3 className="gcard__name">{item.name}</h3>
        <p className="gcard__about">{item.about}</p>
        {chips.length > 0 ? (
          <p className="gcard__chips caps">
            {chips.map((chip) => (
              <span key={chip}>{chip}</span>
            ))}
          </p>
        ) : null}
        {item.kind === "optin" ? (
          <p id={note} className="gcard__note">
            {t("gallery.optin.note")}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        className="gcard__action"
        data-primary={isAddable(item) ? "true" : undefined}
        disabled={item.kind === "optin"}
        aria-describedby={item.kind === "optin" ? note : undefined}
        aria-label={`${item.onDock ? t("gallery.remove") : t("gallery.add")} ${item.name}`}
        onClick={() => toggleOnDock(item)}
      >
        {item.onDock ? <Icon name="check" /> : <Icon name="plus" />}
        {item.onDock ? t("gallery.onDock") : t("gallery.add")}
      </button>
    </li>
  );
}

/**
 * The widget gallery: every tile with a live preview, every stack not on the dock, and the closed slots for the
 * account-based tiles. Searching narrows it, the chips pick a group; a card is added with its button or by dragging it
 * onto the dock. Esc clears the search, then closes.
 */
export function Gallery({ open }: { readonly open: OpenGallery }) {
  const settings = useDockStore((s) => s.settings);
  const categories = useDockStore((s) => s.categories);
  const apps = useDockStore((s) => s.apps);
  const viewport = useViewport();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<GalleryCategory | "all">("all");

  const pinnedStacks = useMemo(() => new Set(settings.pinned.flatMap((p) => (p.kind === "stack" ? [p.category] : []))), [settings.pinned]);
  const items = useMemo(() => galleryItems({ tiles: settings.tiles, pinnedStacks, categories, apps }), [settings.tiles, pinnedStacks, categories, apps]);
  const shown = useMemo(() => filterGallery(items, query, group), [items, query, group]);
  const counts = useMemo(() => categoryCounts(items, query), [items, query]);
  const anchor: Rect = open.from;
  const pos = placeBesideDock(anchor, { w: GALLERY.w, h: GALLERY.h }, viewport, GALLERY.gapToDock);

  useLayoutEffect(() => {
    markOpenPainted("gallery");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || useDockStore.getState().menu !== null) return;
      e.preventDefault();
      if (query !== "") setQuery("");
      else useDockStore.getState().showGallery(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [query]);

  const startDrag = (item: GalleryItem, e: DragEvent): void => {
    e.dataTransfer.setData(GALLERY_MIME, item.key);
    e.dataTransfer.effectAllowed = "copy";
  };

  const style = {
    transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
    width: GALLERY.w,
    height: GALLERY.h,
    "--tone": "var(--accent)",
    "--pop-pad": `${GALLERY.pad}px`,
    "--pop-head": `${GALLERY.head}px`,
    "--card-min": `${GALLERY.cardMin}px`,
    "--card-gap": `${GALLERY.gap}px`,
  } as CSSProperties;

  return (
    <div className="popover gallery" role="dialog" aria-label={t("gallery.title")} style={style} data-open="true">
      <div className="popover__plate" />
      <div className="popover__content">
        <header className="popover__head">
          <i className="popover__dot" />
          <h2 className="popover__title">{t("gallery.title")}</h2>
          <button type="button" className="tp-icon gallery__close" aria-label={t("gallery.close")} onClick={() => useDockStore.getState().showGallery(null)}>
            <Icon name="cross" />
          </button>
        </header>
        <input
          className="gallery__search"
          type="search"
          autoFocus
          value={query}
          placeholder={t("gallery.search")}
          aria-label={t("gallery.search")}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="gallery__chips" role="tablist" aria-label={t("gallery.title")}>
          {(["all", ...GALLERY_CATEGORIES] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              className="gallery__chip"
              aria-selected={group === id}
              disabled={id !== "all" && counts[id] === 0}
              onClick={() => setGroup(id)}
            >
              {id === "all" ? t("gallery.category.all") : categoryName(id)}
              <span className="gallery__count">{counts[id]}</span>
            </button>
          ))}
        </div>
        {shown.length > 0 ? (
          <ul className="gallery__grid" aria-label={t("gallery.title")}>
            {shown.map((item) => (
              <Card key={item.key} item={item} onDragStart={startDrag} />
            ))}
          </ul>
        ) : (
          <div className="tp-empty">
            <EmptyGlyph size={44} />
            <p>{t("gallery.empty.title", { query })}</p>
            <p className="tp-hint">{t("gallery.empty.hint")}</p>
          </div>
        )}
        <p className="gallery__hint tp-hint">{t("gallery.hint")}</p>
      </div>
    </div>
  );
}
