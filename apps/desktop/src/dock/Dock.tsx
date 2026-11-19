import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { AnimatePresence } from "motion/react";
import { Bar, type BarLayout } from "./Bar";
import { EditBanner } from "./EditBanner";
import { chooseEffects, readCapabilities } from "./effects";
import type { Rect } from "./geometry";
import { loadContextMenu, loadLibrary, loadPreview, loadStackPopover, prefetchPanels } from "./prefetch";
import { usePreviewHover } from "./previewIntent";
import { useDockStore } from "./store";
import { useAutoHide, useKeyboardFocus, useNoticeTimeout, useRegions, type PanelRects } from "./useDockShell";
import { useViewport } from "./useViewport";
import "./dock.css";

const StackPopover = lazy(() => loadStackPopover().then((m) => ({ default: m.StackPopover })));
const ContextMenu = lazy(() => loadContextMenu().then((m) => ({ default: m.ContextMenu })));
const Library = lazy(() => loadLibrary().then((m) => ({ default: m.Library })));
const Preview = lazy(() => loadPreview().then((m) => ({ default: m.Preview })));

const sameRect = (a: Rect | null, b: Rect | null): boolean =>
  a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

function sameLayout(a: BarLayout, b: BarLayout): boolean {
  return sameRect(a.bar, b.bar) && a.edge === b.edge && a.growth === b.growth && a.headroom === b.headroom && a.metrics.icon === b.metrics.icon;
}

/** The dock window: the bar and everything that opens from it. Nothing here knows where its data came from. */
export function Dock() {
  const ready = useDockStore((s) => s.ready);
  const autoHide = useDockStore((s) => s.settings.autoHide);
  const pointerInside = useDockStore((s) => s.pointerInside);
  const editing = useDockStore((s) => s.editing);
  const libraryOpen = useDockStore((s) => s.libraryOpen);
  const stack = useDockStore((s) => s.stack);
  const menu = useDockStore((s) => s.menu);
  const previewKey = useDockStore((s) => s.previewKey);
  const notice = useDockStore((s) => s.notice);
  const frozen = useDockStore((s) => s.frozen);
  const choice = useDockStore((s) => s.effectsChoice);
  const viewport = useViewport();
  const [capabilities] = useState(readCapabilities);
  const effects = chooseEffects(choice, capabilities);
  const [layout, setLayout] = useState<BarLayout | null>(null);
  const [panels, setPanels] = useState<PanelRects>({});

  const modal = libraryOpen || stack !== null || menu !== null;
  const busy = pointerInside || editing || modal;
  const hidden = useAutoHide(autoHide && !frozen, busy);
  useRegions(layout, hidden, panels, viewport, modal);
  useKeyboardFocus(editing || modal);
  useNoticeTimeout();
  usePreviewHover(!editing && !modal);

  // The panels are code-split: the first time the pointer nears the dock they start loading, before any click needs them.
  useEffect(() => {
    if (pointerInside) prefetchPanels();
  }, [pointerInside]);

  const onLayout = useCallback((next: BarLayout) => setLayout((previous) => (previous && sameLayout(previous, next) ? previous : next)), []);
  const setRect = useCallback((id: string, rect: Rect | null) => {
    setPanels((previous) => (sameRect(previous[id] ?? null, rect) ? previous : { ...previous, [id]: rect }));
  }, []);
  const rects = useMemo(
    () => ({ preview: (rect: Rect | null) => setRect("preview", rect), edit: (rect: Rect | null) => setRect("edit", rect) }),
    [setRect],
  );

  if (!ready) return null;
  const closeTop = (): void => {
    const store = useDockStore.getState();
    if (store.menu) store.setMenu(null);
    else store.openStack(null);
  };
  const rootVars = layout
    ? ({ "--d-bar": `${layout.metrics.bar}px`, "--d-edge": `${layout.metrics.edge}px`, "--d-icon": `${layout.metrics.icon}px` } as CSSProperties)
    : undefined;

  return (
    <main className="dock-root" data-effects={effects} data-frozen={frozen ? "true" : undefined} data-edge={layout?.edge} style={rootVars}>
      <AnimatePresence>
        {libraryOpen ? (
          <Suspense key="library" fallback={null}>
            <Library />
          </Suspense>
        ) : null}
      </AnimatePresence>
      {stack !== null || menu !== null ? <div className="scrim" onPointerDown={closeTop} onContextMenu={(e) => (e.preventDefault(), closeTop())} /> : null}
      <Bar hidden={hidden} onLayout={onLayout} />
      <AnimatePresence>
        {stack !== null && !libraryOpen ? (
          <Suspense key={stack.category} fallback={null}>
            <StackPopover stack={stack} />
          </Suspense>
        ) : null}
      </AnimatePresence>
      {previewKey !== null && !editing && !modal ? (
        <Suspense fallback={null}>
          <Preview onRect={rects.preview} />
        </Suspense>
      ) : null}
      {menu !== null ? (
        <Suspense fallback={null}>
          <ContextMenu target={menu} />
        </Suspense>
      ) : null}
      {editing && layout ? <EditBanner layout={layout} onRect={rects.edit} /> : null}
      {notice && layout ? (
        <div
          key={notice.id}
          className="notice"
          role="status"
          data-edge={layout.edge}
          style={{ "--notice-x": `${layout.bar.x + layout.bar.w / 2}px`, "--notice-y": `${layout.bar.y + layout.bar.h / 2}px` } as CSSProperties}
        >
          <i />
          {notice.text}
        </div>
      ) : null}
    </main>
  );
}
