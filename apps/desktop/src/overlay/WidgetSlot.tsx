import { lazy, memo, Suspense, type CSSProperties, type MouseEvent } from "react";
import { cellStartPx, type GridMetrics } from "../lib/layout/grid";
import { footprintOf } from "../lib/layout/ops";
import type { Placement } from "../lib/model/types";
import { renderWidget, widgetCatalog, type WidgetInstance } from "./catalog";
import { useEditUi } from "./editUi";

const SlotChrome = lazy(() => import("./edit/SlotChrome").then((m) => ({ default: m.SlotChrome })));

/** Re-renders only when the widget's own identity, size or config change, never because it moved. */
const WidgetContent = memo(function WidgetContent({ kind, size, config }: WidgetInstance) {
  return <>{renderWidget({ kind, size, config })}</>;
});

export interface WidgetSlotProps {
  readonly placement: Placement;
  readonly metrics: GridMetrics;
  readonly editing: boolean;
  readonly selected: boolean;
  readonly locked: boolean;
  readonly onContextMenu: (id: string, event: MouseEvent) => void;
}

/**
 * One widget on the desktop. It is positioned with a transform (never left/top), so moving it, in
 * edit mode or when a neighbour pushes it aside, stays on the compositor and never triggers layout.
 */
export const WidgetSlot = memo(function WidgetSlot({ placement, metrics, editing, selected, locked, onContextMenu }: WidgetSlotProps) {
  // During a resize the previewed size replaces the stored one; during a move the slot keeps its
  // stored position and only the preview of *other* widgets applies.
  const live = useEditUi((s) => s.preview?.get(placement.id)) ?? placement;
  const gesture = useEditUi((s) => (s.activeId === placement.id ? s.gesture : null));
  const meta = widgetCatalog.get(live.kind);
  if (!meta && !editing) return null;

  const { w, h } = footprintOf(widgetCatalog, live);
  const style = {
    "--w": w,
    "--h": h,
    "--tx": `${cellStartPx(live.x, metrics)}px`,
    "--ty": `${cellStartPx(live.y, metrics)}px`,
  } as CSSProperties;
  const name = meta?.name ?? "Unavailable widget";
  const label = `${name}, ${w} by ${h} cells, column ${live.x + 1}, row ${live.y + 1}`;
  const classes = ["overlay__slot", editing ? "is-editing" : "", selected ? "is-selected" : "", gesture === "move" ? "is-dragging" : ""];

  return (
    <div
      className={classes.filter(Boolean).join(" ")}
      style={style}
      data-hit
      data-slot-id={placement.id}
      role={editing ? "group" : undefined}
      aria-roledescription={editing ? "widget" : undefined}
      aria-label={editing ? label : undefined}
      tabIndex={editing ? 0 : undefined}
      onContextMenu={(e) => onContextMenu(placement.id, e)}
    >
      <div className="overlay__content" aria-hidden={editing ? true : undefined}>
        {meta ? (
          <WidgetContent kind={live.kind} size={live.size} config={live.config} />
        ) : (
          <div className="overlay__missing">
            <span className="caps">Unavailable</span>
            <span className="overlay__missing-kind">{live.kind}</span>
          </div>
        )}
      </div>
      {editing ? (
        <Suspense fallback={null}>
          <SlotChrome id={placement.id} name={name} selected={selected} locked={locked} resizable={(meta?.sizes.length ?? 0) > 1} />
        </Suspense>
      ) : null}
    </div>
  );
});
