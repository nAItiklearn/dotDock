import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Icon } from "../design-system/Icon";
import { actions } from "./bridge";
import { clampMagnification, placeBesideDock, PREVIEW, previewLayout, type Rect } from "./geometry";
import { enterPreview, leavePreview, subjectFor } from "./previewIntent";
import { towardInside } from "./regions";
import { useDockStore } from "./store";
import { plural, t } from "./strings";
import { useViewport } from "./useViewport";
import "./panels.css";

/** Gap between the item and its preview, beyond the room the magnified item takes. */
const PREVIEW_GAP = 12;

export interface PreviewProps {
  /** Reports the panel's rectangle so the core lets the pointer reach it; null when it closes. */
  readonly onRect: (rect: Rect | null) => void;
}

/**
 * Window previews for a running app. The core draws the live thumbnails (DWM) into the `well` rectangle this
 * panel reports through `dock_preview`; the panel supplies the frame, the titles and the buttons. It is
 * mounted only while a preview is open.
 */
export function Preview({ onRect }: PreviewProps) {
  const key = useDockStore((s) => s.previewKey);
  const apps = useDockStore((s) => s.apps);
  const windows = useDockStore((s) => s.windows);
  const iconSize = useDockStore((s) => s.settings.iconSize);
  const magnification = useDockStore((s) => s.settings.magnification);
  const viewport = useViewport();
  const subject = useMemo(() => subjectFor(key, { apps, windows }), [key, apps, windows]);
  const [anchor, setAnchor] = useState<Rect | null>(null);

  const subjectKey = subject?.key ?? null;
  useEffect(() => {
    if (subjectKey === null) {
      setAnchor(null);
      return;
    }
    const slot = document.querySelector<HTMLElement>(`[data-key="${CSS.escape(subjectKey)}"]`);
    if (!slot) return;
    const r = slot.getBoundingClientRect();
    const lift = (clampMagnification(magnification) - 1) * r.height;
    setAnchor(towardInside({ x: r.left, y: r.top, w: r.width, h: r.height }, lift));
  }, [subjectKey, magnification, iconSize]);

  const layout = useMemo(() => previewLayout(subject?.windows.length ?? 0), [subject?.windows.length]);
  const pos = anchor ? placeBesideDock(anchor, layout, viewport, PREVIEW_GAP) : null;
  const x = pos?.x;
  const y = pos?.y;

  useEffect(() => {
    if (!subject || x === undefined || y === undefined) {
      onRect(null);
      return undefined;
    }
    onRect({ x, y, w: layout.w, h: layout.h });
    const hwnds = subject.windows.slice(0, layout.shown).map((w) => w.hwnd);
    actions.preview({ hwnds, anchor: { x: x + layout.well.x, y: y + layout.well.y, w: layout.well.w, h: layout.well.h } });
    return () => {
      actions.preview({ hwnds: [] });
      onRect(null);
    };
  }, [subject, x, y, layout, onRect]);

  if (!subject || x === undefined || y === undefined) return null;
  const style = {
    left: x,
    top: y,
    width: layout.w,
    height: layout.h,
    "--slot-w": `${PREVIEW.slotW}px`,
    "--slot-h": `${PREVIEW.slotH}px`,
    "--prev-pad": `${PREVIEW.pad}px`,
    "--prev-head": `${PREVIEW.header}px`,
    "--prev-row": `${PREVIEW.row}px`,
    "--prev-gap": `${PREVIEW.slotGap}px`,
  } as CSSProperties;
  const slots = subject.windows.slice(0, layout.shown);
  const rows = subject.windows.slice(0, PREVIEW.maxRows);
  const hidden = subject.windows.length - rows.length;

  return (
    <div className="preview" role="group" aria-label={subject.name} style={style} onPointerEnter={() => enterPreview(subject.key)} onPointerLeave={leavePreview}>
      <header className="preview__head">
        <img className="art preview__icon" src={subject.icon} alt="" draggable={false} />
        <span className="preview__name">{subject.name}</span>
        <span className="caps">{plural("preview.windows", subject.windows.length)}</span>
      </header>
      <div className="preview__well" style={{ gridTemplateColumns: `repeat(${slots.length}, ${PREVIEW.slotW}px)` }}>
        {slots.map((w) => (
          <button key={w.hwnd} type="button" className="preview__slot" aria-label={w.title} onClick={() => void actions.activate(w.hwnd, subject.name)}>
            <img className="art" src={w.icon} alt="" draggable={false} />
          </button>
        ))}
      </div>
      <ul className="preview__rows">
        {rows.map((w) => (
          <li key={w.hwnd} className="preview__row" data-focused={w.focused ? "true" : undefined}>
            <button type="button" className="preview__title" onClick={() => void actions.activate(w.hwnd, subject.name)}>
              <span className="preview__text">{w.title === "" ? t("preview.untitled") : w.title}</span>
              {w.minimized ? <span className="caps">{t("preview.minimized")}</span> : null}
            </button>
            <button type="button" className="preview__close" aria-label={t("menu.closeWindow")} onClick={() => void actions.closeWindows([w.hwnd])}>
              <Icon name="cross" />
            </button>
          </li>
        ))}
        {hidden > 0 ? <li className="preview__more caps">{t("preview.more", { count: hidden })}</li> : null}
      </ul>
    </div>
  );
}
