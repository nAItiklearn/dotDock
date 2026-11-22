import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { Bar, type BarLayout } from "./Bar";
import { EditBanner } from "./EditBanner";
import { chooseEffects, readCapabilities } from "./effects";
import type { Rect } from "./geometry";
import { loadContextMenu, loadGallery, loadLibrary, loadPrefs, loadPreview, loadStackPopover, loadTilePopover, usePanel, whenIdle } from "./prefetch";
import { pointerMode } from "./regions";
import { useDockStore } from "./store";
import { isTranslucent, resolveTheme } from "./theme";
import { useAutoHide, useCloseOnBlur, useKeyboardFocus, useNoticeTimeout, useOpenPanelRects, useRegions, type PanelRects } from "./useDockShell";
import { useDockPalette } from "./useDockTheme";
import { useViewport } from "./useViewport";
import "./dock.css";

const ContextMenu = lazy(() => loadContextMenu().then((m) => ({ default: m.ContextMenu })));
const Preview = lazy(() => loadPreview().then((m) => ({ default: m.Preview })));

/** Latest the browser may wait for an idle moment before the panels start loading and mounting anyway. */
const IDLE_TIMEOUT_MS = 1000;

/** True once the browser has been idle after the dock first painted. */
function useIdleAfter(ready: boolean): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => (ready && !idle ? whenIdle(() => setIdle(true), IDLE_TIMEOUT_MS) : undefined), [ready, idle]);
  return idle;
}

/**
 * Counts up to `total`, one step per idle moment once `active`. Each step mounts one more panel, so getting every
 * panel ready never costs one long task.
 */
function useStepsWhenIdle(active: boolean, total: number): number {
  const [steps, setSteps] = useState(0);
  useEffect(() => (active && steps < total ? whenIdle(() => setSteps((n) => n + 1), IDLE_TIMEOUT_MS) : undefined), [active, steps, total]);
  return Math.min(steps, total);
}

const sameRect = (a: Rect | null, b: Rect | null): boolean =>
  a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

function sameLayout(a: BarLayout, b: BarLayout): boolean {
  return sameRect(a.bar, b.bar) && a.growth === b.growth && a.headroom === b.headroom && a.metrics.icon === b.metrics.icon;
}

/** The dock window: the bar and everything that opens from it. Nothing here knows where its data came from. */
export function Dock() {
  const ready = useDockStore((s) => s.ready);
  const autoHide = useDockStore((s) => s.settings.autoHide);
  const pointerInside = useDockStore((s) => s.pointerInside);
  const editing = useDockStore((s) => s.editing);
  const libraryOpen = useDockStore((s) => s.libraryOpen);
  const stack = useDockStore((s) => s.stack);
  const tile = useDockStore((s) => s.tile);
  const gallery = useDockStore((s) => s.gallery);
  const prefs = useDockStore((s) => s.prefs);
  const pinned = useDockStore((s) => s.settings.pinned);
  const menu = useDockStore((s) => s.menu);
  const previewKey = useDockStore((s) => s.previewKey);
  const notice = useDockStore((s) => s.notice);
  const frozen = useDockStore((s) => s.frozen);
  const choice = useDockStore((s) => s.effectsChoice);
  const themeChoice = useDockStore((s) => s.themeChoice);
  const backdrop = useDockStore((s) => s.backdrop);
  const rootRef = useRef<HTMLElement>(null);
  const viewport = useViewport();
  const [capabilities] = useState(readCapabilities);
  const effects = chooseEffects(choice, capabilities);
  const theme = resolveTheme(themeChoice, effects, backdrop);
  const mode = useDockPalette(rootRef, theme, ready);
  const [layout, setLayout] = useState<BarLayout | null>(null);
  const [panels, setPanels] = useState<PanelRects>({});

  const { panelOpen: modal, fullscreen, keyboard } = pointerMode({ libraryOpen, stack, tile, gallery, prefs, menu, editing });
  const busy = pointerInside || editing || modal;
  const hidden = useAutoHide(autoHide && !frozen, busy);
  const openRects = useOpenPanelRects(rootRef, modal);
  const hitPanels = useMemo(() => ({ ...panels, ...openRects }), [panels, openRects]);
  useRegions(layout, hidden, autoHide && !frozen, hitPanels, viewport, fullscreen);
  useCloseOnBlur(modal);
  useKeyboardFocus(keyboard);
  useNoticeTimeout();

  // The panels are code-split but never loaded on demand: they load when the browser is first idle after the first
  // paint, then the stacks and the library are mounted, hidden, one per idle moment. Opening one is then a flip.
  const idle = useIdleAfter(ready);
  const stackModule = usePanel(loadStackPopover, idle || stack !== null);
  const libraryModule = usePanel(loadLibrary, idle || libraryOpen);
  const tileModule = usePanel(loadTilePopover, idle || tile !== null);
  const galleryModule = usePanel(loadGallery, idle || gallery !== null);
  const prefsModule = usePanel(loadPrefs, idle || prefs !== null);
  useEffect(() => (idle ? whenIdle(() => void Promise.all([loadContextMenu(), loadPreview()]), IDLE_TIMEOUT_MS) : undefined), [idle]);
  const stackCategories = useMemo(() => pinned.flatMap((p) => (p.kind === "stack" ? [p.category] : [])), [pinned]);
  const warmStacks = useStepsWhenIdle(stackModule !== null, stackCategories.length);
  const warmLibrary = useStepsWhenIdle(libraryModule !== null && warmStacks === stackCategories.length, 1) === 1;
  const readyStacks = useMemo(() => {
    const warm = stackCategories.slice(0, warmStacks);
    return stack !== null && !warm.includes(stack.category) ? [...warm, stack.category] : warm;
  }, [stackCategories, warmStacks, stack]);

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
    else if (store.tile) store.showTile(null);
    else if (store.gallery) store.showGallery(null);
    else if (store.prefs) store.showPrefs(null);
    else store.openStack(null);
  };
  const rootVars = layout
    ? ({ "--d-bar": `${layout.metrics.bar}px`, "--d-edge": `${layout.metrics.edge}px`, "--d-icon": `${layout.metrics.icon}px` } as CSSProperties)
    : undefined;

  return (
    <main
      ref={rootRef}
      className="dock-root"
      data-effects={effects}
      data-dock-theme={theme}
      data-backdrop={backdrop.tone ?? mode}
      data-seamless={isTranslucent(theme) ? "true" : undefined}
      data-frozen={frozen ? "true" : undefined}
      style={rootVars}
    >
      {libraryModule !== null && (warmLibrary || libraryOpen) ? <libraryModule.Library open={libraryOpen} /> : null}
      {stack !== null || tile !== null || gallery !== null || prefs !== null || menu !== null ? <div className="scrim" onPointerDown={closeTop} onContextMenu={(e) => (e.preventDefault(), closeTop())} /> : null}
      <Bar hidden={hidden} onLayout={onLayout} />
      {stackModule !== null ? <stackModule.StackLayer categories={readyStacks} open={libraryOpen ? null : stack} /> : null}
      {tile !== null && tileModule !== null ? <tileModule.TilePopover open={tile} /> : null}
      {gallery !== null && galleryModule !== null ? <galleryModule.Gallery open={gallery} /> : null}
      {prefs !== null && prefsModule !== null ? <prefsModule.Prefs from={layout?.bar ?? prefs.from} drawn={theme} /> : null}
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
          style={{ "--notice-x": `${layout.bar.x + layout.bar.w / 2}px`, "--notice-y": `${layout.bar.y + layout.bar.h / 2}px` } as CSSProperties}
        >
          <i />
          {notice.text}
        </div>
      ) : null}
    </main>
  );
}
