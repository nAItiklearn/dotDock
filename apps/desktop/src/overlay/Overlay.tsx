import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { boundsFor, type GridMetrics } from "../lib/layout/grid";
import { getNativeApi } from "../lib/native/api";
import { effectiveEdgeMargin } from "../lib/theme/appearance";
import { useAppearance } from "../lib/theme/useAppearance";
import { getApp } from "../lib/state/app";
import { useLayoutStore, useNoticeStore, useSettingsStore } from "../lib/state/hooks";
import { eventMatches } from "../lib/shortcuts";
import { isTauri } from "../providers/bridge";
import { NoticeToasts } from "./NoticeToasts";
import { editUi, resetEditUi, useEditUi } from "./editUi";
import { invalidateHitRegions, reportEditMode, reportFirstFrame, syncHitRegions } from "./nativeHost";
import { WidgetSlot } from "./WidgetSlot";
import "./Overlay.css";

const EditLayer = lazy(() => import("./edit/EditLayer").then((m) => ({ default: m.EditLayer })));

/** Falls back to the stylesheet's own value if the token is missing; keeps JS and CSS from drifting apart. */
const FALLBACK_CELL_PX = 76;

function readCellPx(): number {
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cell"));
  return Number.isFinite(value) && value > 0 ? value : FALLBACK_CELL_PX;
}

function useGridMetrics(): GridMetrics {
  const gap = useSettingsStore((s) => s.settings.layout.gap);
  const edge = useSettingsStore((s) => effectiveEdgeMargin(s.settings, getApp().monitorId));
  const [cell] = useState(readCellPx);
  return useMemo(() => ({ cell, gap, edge }), [cell, gap, edge]);
}

function useViewport(): { readonly width: number; readonly height: number } {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    let frame = 0;
    const onResize = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setSize({ width: window.innerWidth, height: window.innerHeight }));
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, []);
  return size;
}

function openSettingsWindow(): void {
  const native = getNativeApi();
  if (native.available) {
    native.window.openSettings().catch((err: unknown) => console.error("could not open settings", err));
  } else {
    window.open(new URL("settings.html", window.location.href), "dotdock-settings");
  }
}

/** The desktop layer: widgets placed on the cell grid over the wallpaper, plus edit mode on demand. */
export function Overlay({ forceThemeId }: { readonly forceThemeId?: string | null }) {
  useAppearance(forceThemeId);
  const app = getApp();
  const root = useRef<HTMLElement>(null);
  const placements = useLayoutStore((s) => s.placements);
  const editing = useLayoutStore((s) => s.editing);
  const selectedId = useLayoutStore((s) => s.selectedId);
  const locked = useSettingsStore((s) => s.settings.layout.locked);
  const shortcuts = useSettingsStore((s) => s.settings.shortcuts);
  const announcement = useEditUi((s) => s.announcement);
  const hasNotices = useNoticeStore((s) => s.notices.length > 0);
  const metrics = useGridMetrics();
  const viewport = useViewport();

  // Tell the layout how many cells this window holds; it keeps stored layouts inside the edges.
  useEffect(() => {
    app.layout.getState().setBounds(boundsFor(viewport.width, viewport.height, metrics));
  }, [app, viewport, metrics]);

  useEffect(() => {
    reportFirstFrame();
    return root.current ? syncHitRegions(root.current) : undefined;
  }, []);

  // Positions are published as custom properties, so the core's click map needs a nudge after they change.
  useEffect(() => {
    invalidateHitRegions();
  }, [placements, metrics, editing]);

  // Entering and leaving edit mode: raise the window in the desktop app, reset transient UI, restore on exit.
  useEffect(() => {
    if (!editing) return undefined;
    reportEditMode(true);
    root.current?.focus({ preventScroll: true });
    return () => {
      reportEditMode(false);
      resetEditUi();
    };
  }, [editing]);

  // Warm the edit-mode chunk once the desktop is up, so the first right-click opens instantly.
  useEffect(() => {
    const warm = (): void => {
      void import("./edit/EditLayer");
      void import("./edit/SlotChrome");
    };
    if ("requestIdleCallback" in window) {
      const handle = window.requestIdleCallback(warm, { timeout: 4000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = setTimeout(warm, 2000);
    return () => clearTimeout(timer);
  }, []);

  // Commands from the tray, global hotkeys and the Settings window.
  useEffect(
    () =>
      app.bus.subscribe((command) => {
        const layout = app.layout.getState();
        if (command.type === "next-profile") {
          app.settings.getState().nextProfile();
        } else if (command.on === "toggle") {
          if (layout.editing) void layout.exitEdit();
          else layout.enterEdit();
        } else if (command.on) {
          layout.enterEdit();
        } else {
          void layout.exitEdit();
        }
      }),
    [app],
  );

  // In the desktop app the core registers global hotkeys; in a plain browser the page listens itself.
  useEffect(() => {
    if (isTauri()) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (eventMatches(e, shortcuts.toggleEditMode)) {
        e.preventDefault();
        const layout = app.layout.getState();
        if (layout.editing) void layout.exitEdit();
        else layout.enterEdit();
      } else if (eventMatches(e, shortcuts.nextProfile)) {
        e.preventDefault();
        app.settings.getState().nextProfile();
      } else if (eventMatches(e, shortcuts.openSettings)) {
        e.preventDefault();
        openSettingsWindow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [app, shortcuts]);

  // The core needs the bindings (it owns global registration); the result tells Settings about conflicts.
  useEffect(() => {
    const native = getNativeApi();
    if (!native.available) return;
    native.shortcuts.register(shortcuts).catch((err: unknown) => console.error("could not register shortcuts", err));
  }, [shortcuts]);

  const onContextMenu = useCallback(
    (id: string, event: MouseEvent) => {
      event.preventDefault();
      app.layout.getState().enterEdit(id);
      if (editUi.getState().drawerOpen) editUi.setState({ drawerTab: "selected" });
    },
    [app],
  );

  return (
    <main className={`overlay${editing ? " overlay--editing" : ""}`} ref={root} tabIndex={-1} aria-label="Desktop widgets">
      {placements.map((p) => (
        <WidgetSlot
          key={p.id}
          placement={p}
          metrics={metrics}
          editing={editing}
          selected={selectedId === p.id}
          locked={locked}
          onContextMenu={onContextMenu}
        />
      ))}
      {editing ? (
        <Suspense fallback={null}>
          <EditLayer rootRef={root} metrics={metrics} openSettings={openSettingsWindow} />
        </Suspense>
      ) : null}
      {hasNotices ? <NoticeToasts /> : null}
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
    </main>
  );
}
