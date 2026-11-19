import { useCallback, useState } from "react";
import { useViewport } from "./useViewport";
import { Bar, type BarLayout } from "./Bar";
import type { Rect } from "./geometry";
import { useDockStore } from "./store";
import { useAutoHide, useKeyboardFocus, useNoticeTimeout, useRegions, type PanelRects } from "./useDockShell";
import "./dock.css";


/** The dock window: the bar and everything that opens from it. Nothing here knows where its data came from. */
export function Dock() {
  const ready = useDockStore((s) => s.ready);
  const autoHide = useDockStore((s) => s.settings.autoHide);
  const pointerInside = useDockStore((s) => s.pointerInside);
  const editing = useDockStore((s) => s.editing);
  const libraryOpen = useDockStore((s) => s.libraryOpen);
  const stack = useDockStore((s) => s.stack);
  const menu = useDockStore((s) => s.menu);
  const notice = useDockStore((s) => s.notice);
  const viewport = useViewport();
  const [layout, setLayout] = useState<BarLayout | null>(null);
  const [panels] = useState<PanelRects>({});

  const busy = pointerInside || editing || libraryOpen || stack !== null || menu !== null;
  const hidden = useAutoHide(autoHide, busy);
  useRegions(layout, hidden, panels, viewport);
  useKeyboardFocus(editing || libraryOpen || stack !== null || menu !== null);
  useNoticeTimeout();

  const onLayout = useCallback((next: BarLayout) => {
    setLayout((previous) => (previous && sameLayout(previous, next) ? previous : next));
  }, []);

  if (!ready) return null;
  return (
    <main className="dock-root">
      <Bar hidden={hidden} onLayout={onLayout} />
      {notice ? (
        <div key={notice.id} className="notice" role="status">
          <i />
          {notice.text}
        </div>
      ) : null}
    </main>
  );
}

const sameRect = (a: Rect, b: Rect): boolean => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

function sameLayout(a: BarLayout, b: BarLayout): boolean {
  return sameRect(a.bar, b.bar) && a.edge === b.edge && a.growth === b.growth && a.headroom === b.headroom && a.metrics.icon === b.metrics.icon;
}
