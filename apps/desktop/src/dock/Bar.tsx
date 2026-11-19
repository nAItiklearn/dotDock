import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { useReducedMotion } from "motion/react";
import { useViewport } from "./useViewport";
import { actions } from "./bridge";
import { DockEngine, type LayoutItem } from "./engine";
import {
  clampMagnification,
  contains,
  fitIconSize,
  isVertical,
  metricsFor,
  RATIO,
  SCREEN_MARGIN,
  type Metrics,
  type Point,
  type Rect,
} from "./geometry";
import { entryLabel, isDraggable, Slot, type SlotHandlers } from "./items";
import { maxGrowth } from "./magnify";
import { activationTarget, buildEntries, lengthKind, pinKey, pinOf, reorderBy, tileKey, unpin, type AppEntry, type BarEntry, type StackEntry } from "./model";
import type { DockEdge } from "./protocol";
import { dockZone, hotStrip } from "./regions";
import { DRAG_THRESHOLD, dropIntent, moveKey, slideOffsets, type DropIntent, type LaneSpan } from "./reorder";
import { useDockStore } from "./store";
import { plural, t } from "./strings";

export interface BarLayout {
  /** The bar at rest, in window CSS px. */
  readonly bar: Rect;
  readonly edge: DockEdge;
  /** Most the row can grow along its axis while magnified. */
  readonly growth: number;
  /** Room magnified items and the label need beyond the bar. */
  readonly headroom: number;
  readonly metrics: Metrics;
}


const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

/** The point on a drawn item that faces the middle of the screen: where menus and panels attach. */
export function anchorPoint(r: Rect, edge: DockEdge): Point {
  switch (edge) {
    case "bottom":
      return { x: r.x + r.w / 2, y: r.y };
    case "top":
      return { x: r.x + r.w / 2, y: r.y + r.h };
    case "left":
      return { x: r.x + r.w, y: r.y + r.h / 2 };
    case "right":
      return { x: r.x, y: r.y + r.h / 2 };
  }
}

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
  const editing = useDockStore((s) => s.editing);
  const stack = useDockStore((s) => s.stack);
  const menu = useDockStore((s) => s.menu);
  const pointerInside = useDockStore((s) => s.pointerInside);
  const reduced = useReducedMotion() ?? false;
  const viewport = useViewport();
  const [roving, setRoving] = useState<string>("library");

  const { edge } = settings;
  const vertical = isVertical(edge);
  const entries = useMemo(
    () => buildEntries({ categories, apps, windows, settings }, { now: Date.now(), seen, editing, status: true }),
    [categories, apps, windows, settings, seen, editing],
  );
  const icon = fitIconSize(settings.iconSize, entries.map(lengthKind), (vertical ? viewport.h : viewport.w) - 2 * SCREEN_MARGIN, vertical);
  const metrics = metricsFor(icon);
  const peak = clampMagnification(settings.magnification);

  const dockRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [engine] = useState(
    () =>
      new DockEngine({ peak, reach: metrics.reach, gap: metrics.gap, edge, reduced }, (key) => useDockStore.getState().setHovered(key)),
  );
  const items = useRef<readonly LayoutItem[]>([]);
  const origin = useRef(0);
  const zone = useRef<Pick<BarLayout, "bar" | "growth" | "headroom">>({ bar: { x: 0, y: 0, w: 0, h: 0 }, growth: 0, headroom: 0 });
  const press = useRef<Press | null>(null);
  const suppressClick = useRef(false);
  const latest = useRef({ entries, editing, settings, vertical, edge, metrics });
  latest.current = { entries, editing, settings, vertical, edge, metrics };

  useEffect(() => {
    engine.configure({ peak, reach: metrics.reach, gap: metrics.gap, edge, reduced });
  }, [engine, peak, metrics.reach, metrics.gap, edge, reduced]);
  useEffect(() => () => engine.destroy(), [engine]);
  const attachLabel = useCallback((el: HTMLElement | null) => engine.attachLabel(el), [engine]);
  useLayoutEffect(() => {
    engine.attachBar(barRef.current);
  }, [engine]);

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
        dots: slot.querySelector<HTMLElement>(":scope > .dots"),
        start: vertical ? slot.offsetTop : slot.offsetLeft,
        size: vertical ? slot.offsetHeight : slot.offsetWidth,
        magnifies: slot.dataset.magnify === "true",
      });
    }
    const lead = vertical ? dock.offsetTop : dock.offsetLeft;
    items.current = measured;
    origin.current = lead;
    engine.setLayout({ items: measured, barStart: 0, barSize: vertical ? dock.offsetHeight : dock.offsetWidth, origin: lead });
    const bar = { x: dock.offsetLeft, y: dock.offsetTop, w: dock.offsetWidth, h: dock.offsetHeight };
    const growth = maxGrowth(measured, peak, metrics.reach);
    const headroom = (peak - 1) * metrics.icon + RATIO.label * metrics.icon;
    zone.current = { bar, growth, headroom };
    onLayout({ bar, edge, growth, headroom, metrics });
  }, [engine, vertical, peak, metrics, edge, onLayout]);

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
      const area = dockZone({ bar, edge, engaged: store.pointerInside, headroom, growth });
      const wake = settings.autoHide && contains(hotStrip(bar, edge, viewport), point);
      const inside = contains(area, point);
      if (inside || wake) store.setPointerInside(true);
      else if (store.pointerInside) store.setPointerInside(false);
      engine.setPointer(inside && !latest.current.editing ? (vertical ? point.y : point.x) : null);
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
  }, [engine, edge, vertical, viewport, settings.autoHide]);

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
      const { vertical: v, metrics: m } = latest.current;
      const main = v ? e.clientY : e.clientX;
      if (!p.started) {
        if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < DRAG_THRESHOLD) return;
        p.started = true;
        engine.beginDrag(p.key, p.grab, main);
        document.documentElement.dataset.dragging = "true";
        useDockStore.getState().setHovered(null);
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

    return {
      activate: (entry, face) => {
        if (suppressClick.current) return;
        const store = useDockStore.getState();
        const { edge: side, editing: isEditing } = latest.current;
        switch (entry.kind) {
          case "library":
            store.setLibrary(true);
            return;
          case "add":
            store.setMenu({ key: entry.key, at: anchorPoint(rectOf(face), side) });
            return;
          case "stack":
            if (store.stack?.category === entry.category.id) {
              store.openStack(null);
              return;
            }
            store.markSeen(entry.apps.map((a) => a.id));
            store.openStack({ category: entry.category.id, from: rectOf(face) });
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
      },
      context: (entry: BarEntry, _event: MouseEvent | KeyboardEvent, face: HTMLElement) => {
        useDockStore.getState().setMenu({ key: entry.key, at: anchorPoint(rectOf(face), latest.current.edge) });
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
      focused: (key) => setRoving(key),
      pointerDown: (entry, e) => {
        const { editing: isEditing, entries: list, vertical: v } = latest.current;
        if (!isEditing || e.button !== 0 || !isDraggable(entry)) return;
        const me = items.current.find((i) => i.key === entry.key);
        if (!me) return;
        const tileLane = entry.kind === "tile";
        const lane: LaneSpan[] = items.current.flatMap((i) => {
          const other = list.find((x) => x.key === i.key);
          if (!other || !isDraggable(other) || (other.kind === "tile") !== tileLane) return [];
          return [{ key: i.key, start: i.start, size: i.size, isStack: other.kind === "stack" }];
        });
        const main = v ? e.clientY : e.clientX;
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
    const back = vertical ? "ArrowUp" : "ArrowLeft";
    const forward = vertical ? "ArrowDown" : "ArrowRight";
    if (e.key !== back && e.key !== forward && e.key !== "Home" && e.key !== "End") return;
    const stops = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(".disc"));
    const at = stops.indexOf(document.activeElement as HTMLElement);
    if (stops.length === 0) return;
    const to = e.key === "Home" ? 0 : e.key === "End" ? stops.length - 1 : Math.min(stops.length - 1, Math.max(0, at + (e.key === forward ? 1 : -1)));
    e.preventDefault();
    stops[to]?.focus();
  };

  const onBarContext = (e: MouseEvent): void => {
    e.preventDefault();
    useDockStore.getState().setMenu({ key: null, at: { x: e.clientX, y: e.clientY } });
  };

  const rovingKey = entries.some((entry) => entry.key === roving && (entry.kind === "app" || entry.kind === "stack" || entry.kind === "library" || entry.kind === "add"))
    ? roving
    : "library";

  const vars = {
    "--d-icon": `${metrics.icon}px`,
    "--d-gap": `${metrics.gap}px`,
    "--d-pad": `${metrics.pad}px`,
    "--d-edge": `${metrics.edge}px`,
    "--d-bar": `${metrics.bar}px`,
    "--d-status": `${RATIO.statusCross * metrics.icon}px`,
  } as CSSProperties;

  return (
    <div className="dock-anchor" data-edge={edge} data-axis={vertical ? "y" : "x"} style={vars}>
      <div ref={dockRef} className="dock" data-hidden={hidden ? "true" : undefined} data-editing={editing ? "true" : undefined} onContextMenu={onBarContext}>
        <div ref={barRef} className="dock__bar" />
        <div ref={rowRef} className="dock__row" role="toolbar" aria-label={t("dock.label")} aria-orientation={vertical ? "vertical" : "horizontal"} onKeyDown={onRowKeyDown}>
          {entries.map((entry) => (
            <Slot
              key={entry.key}
              entry={entry}
              icon={metrics.icon}
              vertical={vertical}
              editing={editing}
              roving={entry.key === rovingKey}
              open={(entry.kind === "stack" && stack?.category === entry.category.id) || (entry.kind === "add" && menu?.key === entry.key)}
              handlers={handlers}
            />
          ))}
        </div>
        <Label entries={entries} suppressed={editing || stack !== null || menu !== null} onElement={attachLabel} />
      </div>
    </div>
  );
}

/** The name of the item under the pointer. The engine moves it; this only supplies the words. */
function Label({ entries, suppressed, onElement }: { readonly entries: readonly BarEntry[]; readonly suppressed: boolean; readonly onElement: (el: HTMLElement | null) => void }) {
  const hoveredKey = useDockStore((s) => s.hoveredKey);
  const entry = hoveredKey === null || suppressed ? undefined : entries.find((e) => e.key === hoveredKey);
  const name = entry ? entryLabel(entry) : "";
  const windowCount = entry?.kind === "app" ? entry.windows.length : 0;
  return (
    <div ref={onElement} className="dock__label" data-visible={name !== "" ? "true" : undefined} aria-hidden="true">
      <span>{name}</span>
      {windowCount > 1 ? <span className="caps">{plural("item.running", windowCount)}</span> : null}
    </div>
  );
}
