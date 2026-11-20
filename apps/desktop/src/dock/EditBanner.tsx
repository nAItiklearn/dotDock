import { useEffect } from "react";
import type { BarLayout } from "./Bar";
import { EDIT_BANNER, placeBesideDock, type Rect } from "./geometry";
import { useDockStore } from "./store";
import { t } from "./strings";
import { useViewport } from "./useViewport";

export interface EditBannerProps {
  readonly layout: BarLayout;
  readonly onRect: (rect: Rect | null) => void;
}

/** Shown while the dock is being edited: what a drag does, and the way out. Esc also leaves edit mode. */
export function EditBanner({ layout, onRect }: EditBannerProps) {
  const viewport = useViewport();
  const pos = placeBesideDock(layout.bar, EDIT_BANNER, layout.edge, viewport, layout.headroom + EDIT_BANNER.gap);
  const { x, y } = pos;

  useEffect(() => {
    onRect({ x, y, w: EDIT_BANNER.w, h: EDIT_BANNER.h });
    return () => onRect(null);
  }, [x, y, onRect]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const { stack, menu, libraryOpen, setEditing } = useDockStore.getState();
      if (e.key !== "Escape" || e.defaultPrevented || stack !== null || menu !== null || libraryOpen) return;
      setEditing(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="edit-banner" role="status" style={{ left: x, top: y, width: EDIT_BANNER.w, height: EDIT_BANNER.h }}>
      <span className="edit-banner__hint">{t("edit.hint")}</span>
      <button type="button" className="edit-banner__done" onClick={() => useDockStore.getState().setEditing(false)}>
        {t("edit.done")}
      </button>
    </div>
  );
}
