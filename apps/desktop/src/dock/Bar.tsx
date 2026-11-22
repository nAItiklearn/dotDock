import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { useReducedMotion } from "./useReducedMotion";
import { useDevicePixelRatio, useViewport } from "./useViewport";
import { actions } from "./bridge";
import { DockEngine, PLATE_OVERLAP, type LayoutItem } from "./engine";
import {
  clampMagnification,
  anchorPoint,
  contains,
  fitIconSize,
  isPopoverTile,
  metricsFor,
  RATIO,
  SCREEN_MARGIN,
  toDevicePixel,
  type Metrics,
  type Rect,
} from "./geometry";
import { dropIndex, GALLERY_MIME, placeTile } from "./galleryItems";
import { isDraggable, Slot, type SlotHandlers } from "./items";
import { maxGrowth } from "./magnify";
import { activationTarget, buildEntries, isTileId, lengthKind, pinKey, pinOf, reorderBy, tileKey, unpin, type AppEntry, type BarEntry, type StackEntry } from "./model";
import { markOpenStart } from "./openMarks";
import { leavePreview, onBarHover } from "./previewIntent";
import { dockZone, hotStrip } from "./regions";
import { DRAG_THRESHOLD, dropIntent, moveKey, slideOffsets, type DropIntent, type LaneSpan } from "./reorder";
import { useDockStore } from "./store";
import { t } from "./strings";

export interface BarLayout {
  /** The bar at rest, in window CSS px. */
  readonly bar: Rect;
  /** Most the row can grow sideways while magnified. */
  readonly growth: number;
  /** Room magnified items and the label need beyond the bar. */
  readonly headroom: number;
  readonly metrics: Metrics;
}


const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

interface Press {
  readonly key: string;
  readonly isApp: boolean;
  readonly lane: readonly LaneSpan[];
  /** Distance from the item's start to where the pointer took hold. */
  readonly grab: number;
  readonly startX: number;
  readonly startY: number;
  started: boolean;
  intent: DropIntent | null;
  dropEl: HTMLElement | null;
}

export interface BarProps {
  readonly hidden: boolean;
  readonly onLayout: (layout: BarLayout) => void;
}

/** The dock bar: renders the entries, measures them for the engine and turns pointer input into motion and actions. */
export function Bar({ hidden, onLayout }: BarProps) {
  const categories = useDockStore((s) => s.categories);
  const apps = useDockStore((s) => s.apps);
  const windows = useDockStore((s) => s.windows);
  const settings = useDockStore((s) => s.settings);
  const seen = useDockStore((s) => s.seen);
  const tileSizes = useDockStore((s) => s.tileSizes);
  const editing = useDockStore((s) => s.editing);
  const stack = useDockStore((s) => s.stack);
  const tile = useDockStore((s) => s.tile);
  const gallery = useDockStore((s) => s.gallery);
  const prefs = useDockStore((s) => s.prefs);
  const menu = useDockStore((s) => s.menu);
  const pointerInside = useDockStore((s) => s.pointerInside);
  const reduced = useReducedMotion();
  const viewport = useViewport();
  const dpr = useDevicePixelRatio();
  const [roving, setRoving] = useState<string>("library");
  const [dropReady, setDropReady] = useState(false);

  const entries = useMemo(
    () => buildEntries({ categories, apps, windows, settings }, { now: Date.now(), seen, editing, status: true, sizes: tileSizes }),
    [categories, apps, windows, settings, seen, editing, tileSizes],
  );
  const icon = fitIconSize(settings.iconSize, entries.map(lengthKind), viewport.w - 2 * SCREEN_MARGIN);
  // One object per icon size: `measure` depends on it, and a new object on every render would re-measure (and force a layout) on every render.
  const metrics = useMemo(() => metricsFor(icon, dpr), [icon, dpr]);
  const peak = clampMagnification(settings.magnification);

  const dockRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const dock = dockRef.current;
    const anchor = anchorRef.current;
    if (!dock || !anchor) return undefined;
    // Centring puts the bar at half the free space, which can fall between two device pixels: nudge the whole
    // anchor by less than one device pixel so every edge inside lands on the grid. Runs when the bar's size
    // changes (an observer, not a timer), never per frame.
    const align = (): void => {
      anchor.style.translate = "";
      const r = dock.getBoundingClientRect();
      const dx = toDevicePixel(r.left, dpr) - r.left;
      const dy = toDevicePixel(r.top, dpr) - r.top;
      anchor.style.translate = dx === 0 && dy === 0 ? "" : `${dx}px ${dy}px`;
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [dpr, viewport.w, viewport.h]);
  const rowRef = useRef<HTMLDivElement>(null);
  const plateStart = useRef<HTMLDivElement>(null);
  const plateMid = useRef<HTMLDivElement>(null);
  const plateEnd = useRef<HTMLDivElement>(null);
  const labelRoot = useRef<HTMLDivElement>(null);
  const labelName = useRef<HTMLSpanElement>(null);
  const labelSub = useRef<HTMLSpanElement>(null);
  const previewKey = useDockStore((s) => s.previewKey);
  const frozen = useDockStore((s) => s.frozen);
  const [engine] = useState(
    () =>
      new DockEngine({ peak, reach: metrics.reach, gap: metrics.gap, reduced }, onBarHover),
  );
  const items = useRef<readonly LayoutItem[]>([]);
  const origin = useRef(0);
  const zone = useRef<Pick<BarLayout, "bar" | "growth" | "headroom">>({ bar: { x: 0, y: 0, w: 0, h: 0 }, growth: 0, headroom: 0 });
  const press = useRef<Press | null>(null);
  const suppressClick = useRef(false);
  const latest = useRef({ entries, editing, settings, metrics });
  latest.current = { entries, editing, settings, metrics };

  useEffect(() => {
    engine.configure({ peak, reach: metrics.reach, gap: metrics.gap, reduced });
  }, [engine, peak, metrics.reach, metrics.gap, reduced]);
  useEffect(() => () => engine.destroy(), [engine]);
  useEffect(() => engine.setFrozen(frozen), [engine, frozen]);
  useLayoutEffect(() => {
    const start = plateStart.current;
    const mid = plateMid.current;
    const end = plateEnd.current;
    if (start && mid && end) engine.attachPlate({ start, mid, end });
    const root = labelRoot.current;
    const name = labelName.current;
    const sub = labelSub.current;
    if (root && name && sub) engine.attachLabel({ root, name, sub });
  }, [engine]);
  const labelBlocked = editing || stack !== null || tile !== null || gallery !== null || menu !== null;
  useEffect(() => engine.setLabelBlocked(labelBlocked), [engine, labelBlocked]);
  useEffect(() => engine.setPreviewKey(previewKey), [engine, previewKey]);
  useEffect(() => {
    if (labelBlocked) leavePreview();
  }, [labelBlocked]);

  const measure = useCallback(() => {
    const dock = dockRef.current;
    const row = rowRef.current;
    if (!dock || !row) return;
    const measured: LayoutItem[] = [];
    for (const child of Array.from(row.children)) {
      const slot = child as HTMLElement;
      const face = slot.querySelector<HTMLElement>(":scope > .face");
      const key = slot.dataset.key;
      if (!face || !key) continue;
      measured.push({
        key,
        el: face,
        start: slot.offsetLeft,
        size: slot.offsetWidth,
        weight: Number(slot.dataset.weight) || 0,
        render: Number.parseFloat(slot.style.getPropertyValue("--r")) || 1,
        name: slot.dataset.name ?? "",
        sub: slot.dataset.sub ?? "",
      });
    }
    const lead = dock.offsetLeft;
    items.current = measured;
    origin.current = lead;
    engine.setLayout({ items: measured, barStart: 0, barSize: dock.offsetWidth, cap: metrics.bar / 2, origin: lead });
    const bar = { x: dock.offsetLeft, y: dock.offsetTop, w: dock.offsetWidth, h: dock.offsetHeight };
    const growth = maxGrowth(measured, peak, metrics.reach);
    const headroom = (peak - 1) * metrics.icon + RATIO.label * metrics.icon;
    zone.current = { bar, growth, headroom };
    onLayout({ bar, growth, headroom, metrics });
  }, [engine, peak, metrics, onLayout]);

  useLayoutEffect(() => {
    measure();
  }, [measure, entries]);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return undefined;
    const observer = new ResizeObserver(() => measure());
    observer.observe(row);
    return () => observer.disconnect();
  }, [measure]);

  // Pointer: the dock zone grows while engaged (magnified icons stand above the bar), so a pointer on a big
  // icon never falls off it. Pointer events only reach this window inside the click regions.
  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      if (e.pointerType === "touch" || press.current?.started) return;
      const store = useDockStore.getState();
      const point = { x: e.clientX, y: e.clientY };
      const { bar, growth, headroom } = zone.current;
      const area = dockZone({ bar, engaged: store.pointerInside, headroom, growth });
      const wake = settings.autoHide && contains(hotStrip(bar, viewport), point);
      const inside = contains(area, point);
      const near = inside || wake;
      if (near !== store.pointerInside) store.setPointerInside(near);
      engine.setPointer(inside && !latest.current.editing ? point.x : null);
    };
    const onLeave = (): void => {
      useDockStore.getState().setPointerInside(false);
      engine.setPointer(null);
    };
    window.addEventListener("pointermove", onMove);
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }, [engine, viewport, settings.autoHide]);

  useEffect(() => {
    if (!pointerInside || editing) engine.setPointer(null);
  }, [engine, pointerInside, editing]);

  const handlers = useMemo<SlotHandlers>(() => {
    const clearDrop = (p: Press): void => {
      if (p.dropEl) delete p.dropEl.dataset.drop;
      p.dropEl = null;
    };

    const commit = (p: Press): void => {
      const { entries: list, settings: current } = latest.current;
      const intent = p.intent;
      if (!intent) return;
      if (intent.type === "file") {
        const dragged = list.find((e) => e.key === p.key) as AppEntry | undefined;
        const target = list.find((e) => e.key === intent.stackKey) as StackEntry | undefined;
        const pinned = dragged ? pinOf(dragged) : null;
        if (!dragged || dragged.appId === null || !target) return;
        void actions.setCategory(dragged.appId, target.category.id);
        if (pinned) void actions.updateSettings({ pinned: unpin(current.pinned, pinned) });
        return;
      }
      const keys = p.lane.map((s) => s.key);
      const ordered = moveKey(keys, p.key, intent.index);
      if (ordered.every((key, i) => key === keys[i])) return;
      if (p.key.startsWith("tile:")) void actions.updateSettings({ tiles: reorderBy(current.tiles, tileKey, ordered) });
      else void actions.updateSettings({ pinned: reorderBy(current.pinned, pinKey, ordered) });
    };

    const onMove = (e: PointerEvent): void => {
      const p = press.current;
      if (!p) return;
      const { metrics: m } = latest.current;
      const main = e.clientX;
      if (!p.started) {
        if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < DRAG_THRESHOLD) return;
        p.started = true;
        engine.beginDrag(p.key, p.grab, main);
        document.documentElement.dataset.dragging = "true";
      }
      engine.moveDrag(main);
      const span = p.lane.find((s) => s.key === p.key);
      const centre = main - origin.current - p.grab + (span?.size ?? 0) / 2;
      const intent = dropIntent(p.lane, p.key, p.isApp, centre);
      p.intent = intent;
      if (intent.type === "reorder") {
        clearDrop(p);
        engine.setSlide(slideOffsets(p.lane, p.key, intent.index, m.gap));
        return;
      }
      const home = p.lane.findIndex((s) => s.key === p.key);
      engine.setSlide(slideOffsets(p.lane, p.key, home, m.gap));
      const el = rowRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(intent.stackKey)}"] .face`) ?? null;
      if (el !== p.dropEl) {
        clearDrop(p);
        if (el) el.dataset.drop = "true";
        p.dropEl = el;
      }
    };

    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      const p = press.current;
      press.current = null;
      delete document.documentElement.dataset.dragging;
      if (!p?.started) return;
      // The click that follows the release must not open or launch the item that was carried.
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      engine.endDrag();
      clearDrop(p);
      commit(p);
      engine.clearSlide();
    };

    /** Opens the panel an item stands for, or launches or focuses the app. */
    const open = (entry: BarEntry, face: HTMLElement): void => {
      const store = useDockStore.getState();
      const { editing: isEditing } = latest.current;
      switch (entry.kind) {
        case "library":
          store.setLibrary(true);
          return;
        case "add":
          store.showGallery(store.gallery === null ? { from: rectOf(face) } : null);
          return;
        case "more":
          store.showPrefs(store.prefs === null ? { from: rectOf(face) } : null);
          return;
        case "stack":
          if (store.stack?.category === entry.category.id) {
            store.openStack(null);
            return;
          }
          store.showStack(entry.category.id, rectOf(face));
          return;
        case "tile":
          if (isEditing || !isPopoverTile(entry.id)) return;
          if (store.tile?.id === entry.id) {
            store.showTile(null);
            return;
          }
          store.showTile({ id: entry.id, from: rectOf(face) });
          return;
        case "app": {
          if (isEditing) return;
          const target = activationTarget(entry.windows);
          if (target) {
            void actions.activate(target.hwnd, entry.name);
            return;
          }
          if (entry.appId === null) return;
          face.classList.remove("is-launching");
          void face.offsetWidth;
          face.classList.add("is-launching");
          face.addEventListener("animationend", () => face.classList.remove("is-launching"), { once: true });
          void actions.launch(entry.appId, entry.name);
          return;
        }
        default:
          return;
      }
    };

    /** Set from the press that opened a panel until the click that ends it has passed, so that click does not toggle the panel shut. */
    let openedOnPress = false;
    const panelOf = (entry: BarEntry): string => (entry.kind === "library" ? "library" : entry.kind === "stack" ? "stack" : entry.kind === "tile" ? "tile" : entry.kind === "add" ? "gallery" : entry.kind === "more" ? "prefs" : "menu");
    const openOnPress = (entry: BarEntry, face: HTMLElement, startedAt: number): void => {
      markOpenStart(panelOf(entry), startedAt);
      open(entry, face);
    };

    return {
      activate: (entry, face) => {
        if (suppressClick.current || openedOnPress) return;
        open(entry, face);
      },
      press: (entry, face, e) => {
        if (e.button !== 0) return;
        openedOnPress = true;
        const release = (): void => {
          window.removeEventListener("pointerup", release);
          window.removeEventListener("pointercancel", release);
          // The click follows the release in the same task; this runs after it.
          window.setTimeout(() => {
            openedOnPress = false;
          }, 0);
        };
        window.addEventListener("pointerup", release);
        window.addEventListener("pointercancel", release);
        openOnPress(entry, face, e.timeStamp);
      },
      pressKey: (entry, face, e) => {
        if (e.repeat) return;
        openOnPress(entry, face, e.timeStamp);
      },
      context: (entry: BarEntry, _event: MouseEvent | KeyboardEvent, face: HTMLElement) => {
        const store = useDockStore.getState();
        store.openStack(null);
        store.setMenu({ key: entry.key, at: anchorPoint(rectOf(face)) });
      },
      remove: (entry) => {
        const { settings: current } = latest.current;
        if (entry.kind === "tile") {
          void actions.updateSettings({ tiles: current.tiles.filter((id) => id !== entry.id) });
          return;
        }
        const pinned = pinOf(entry);
        if (pinned) void actions.updateSettings({ pinned: unpin(current.pinned, pinned) });
      },
      resize: (entry) => {
        if (entry.kind !== "tile") return;
        useDockStore.getState().setTileSize(entry.id, entry.size === "compact" ? "regular" : "compact");
      },
      focused: (key) => setRoving(key),
      pointerDown: (entry, e) => {
        const { editing: isEditing, entries: list } = latest.current;
        if (!isEditing || e.button !== 0 || !isDraggable(entry)) return;
        const me = items.current.find((i) => i.key === entry.key);
        if (!me) return;
        const tileLane = entry.kind === "tile";
        const lane: LaneSpan[] = items.current.flatMap((i) => {
          const other = list.find((x) => x.key === i.key);
          if (!other || !isDraggable(other) || (other.kind === "tile") !== tileLane) return [];
          return [{ key: i.key, start: i.start, size: i.size, isStack: other.kind === "stack" }];
        });
        const main = e.clientX;
        press.current = {
          key: entry.key,
          isApp: entry.kind === "app",
          lane,
          grab: main - (origin.current + me.start),
          startX: e.clientX,
          startY: e.clientY,
          started: false,
          intent: null,
          dropEl: null,
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
      },
    };
  }, [engine]);

  const onRowKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const back = "ArrowLeft";
    const forward = "ArrowRight";
    if (e.key !== back && e.key !== forward && e.key !== "Home" && e.key !== "End") return;
    const stops = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(".disc, .tile__hit"));
    const at = stops.indexOf(document.activeElement as HTMLElement);
    if (stops.length === 0) return;
    const to = e.key === "Home" ? 0 : e.key === "End" ? stops.length - 1 : Math.min(stops.length - 1, Math.max(0, at + (e.key === forward ? 1 : -1)));
    e.preventDefault();
    stops[to]?.focus();
  };

  /** A card dragged from the gallery over the dock: it may be dropped here, and shows where. */
  const onGalleryDrag = (e: DragEvent<HTMLDivElement>): void => {
    if (!e.dataTransfer.types.includes(GALLERY_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropReady(true);
  };

  /** Drops a tile from the gallery among the tiles on the dock, before the first one whose middle is past the pointer. */
  const onGalleryDrop = (e: DragEvent<HTMLDivElement>): void => {
    setDropReady(false);
    const id = e.dataTransfer.getData(GALLERY_MIME).replace(/^tile:/, "");
    if (!e.dataTransfer.types.includes(GALLERY_MIME) || !isTileId(id)) return;
    e.preventDefault();
    const { settings: current } = latest.current;
    const middles = current.tiles
      .filter((tileId): tileId is typeof id => isTileId(tileId) && tileId !== id)
      .flatMap((tileId) => {
        const placed = items.current.find((i) => i.key === tileKey(tileId));
        return placed ? [origin.current + placed.start + placed.size / 2] : [];
      });
    void actions.updateSettings({ tiles: placeTile(current.tiles, id, dropIndex(middles, e.clientX)) });
  };

  const onBarContext = (e: MouseEvent): void => {
    e.preventDefault();
    const store = useDockStore.getState();
    store.openStack(null);
    store.setMenu({ key: null, at: { x: e.clientX, y: e.clientY } });
  };

  const rovingKey = entries.some((entry) => entry.key === roving && (entry.kind === "app" || entry.kind === "stack" || entry.kind === "library" || entry.kind === "add" || entry.kind === "more"))
    ? roving
    : "library";

  const vars = {
    "--d-icon": `${metrics.icon}px`,
    "--d-base": `${metrics.icon}px`,
    "--d-gap": `${metrics.gap}px`,
    "--d-pad": `${metrics.pad}px`,
    "--d-edge": `${metrics.edge}px`,
    "--d-bar": `${metrics.bar}px`,
    "--d-status": `${RATIO.statusCross * metrics.icon}px`,
    "--d-overlap": `${PLATE_OVERLAP}px`,
  } as CSSProperties;

  return (
    <div ref={anchorRef} className="dock-anchor" data-mag={peak > 1 && !reduced ? "on" : "off"} style={vars}>
      <div
        ref={dockRef}
        className="dock"
        data-hidden={hidden ? "true" : undefined}
        data-editing={editing ? "true" : undefined}
        data-drop={dropReady ? "true" : undefined}
        onContextMenu={onBarContext}
        onDragOver={onGalleryDrag}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropReady(false)}
        onDrop={onGalleryDrop}
      >
        <div className="plate" aria-hidden="true">
          <div ref={plateMid} className="plate__mid" />
          <div ref={plateStart} className="plate__cap plate__cap--start" />
          <div ref={plateEnd} className="plate__cap plate__cap--end" />
        </div>
        <div ref={rowRef} className="dock__row" role="toolbar" aria-label={t("dock.label")} aria-orientation="horizontal" onKeyDown={onRowKeyDown}>
          {entries.map((entry) => (
            <Slot
              key={entry.key}
              entry={entry}
              icon={metrics.icon}
              editing={editing}
              roving={entry.key === rovingKey}
              peak={peak}
              open={(entry.kind === "stack" && stack?.category === entry.category.id) || (entry.kind === "add" && gallery !== null) || (entry.kind === "more" && prefs !== null) || (entry.kind === "tile" && tile?.id === entry.id)}
              handlers={handlers}
              dpr={dpr}
            />
          ))}
        </div>
        <div ref={labelRoot} className="dock__label" aria-hidden="true">
          <span ref={labelName} />
          <span ref={labelSub} className="caps" />
        </div>
      </div>
    </div>
  );
}
