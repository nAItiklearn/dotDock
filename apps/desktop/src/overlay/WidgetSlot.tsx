import { lazy, memo, Suspense, useState, type CSSProperties, type MouseEvent } from "react";
import { cellStartPx, type GridMetrics } from "../lib/layout/grid";
import { footprintOf } from "../lib/layout/ops";
import type { Placement } from "../lib/model/types";
import { Icon } from "../lib/ui/Icon";
import { WidgetView } from "../widgets/WidgetView";
import { widgetCatalog } from "./catalog";
import { useEditUi } from "./editUi";

let bootSettled = false;

/**
 * Called once the first layout is on screen. Widgets that mount after this (added, duplicated, a removal
 * undone) play the enter animation; the boot frame is final and never animates (MASTER_SPEC 7).
 */
export function markBootSettled(): void {
  bootSettled = true;
}

const SlotChrome = lazy(() => import("./edit/SlotChrome").then((m) => ({ default: m.SlotChrome })));

type WidgetContentProps = Pick<Placement, "id" | "widget" | "size" | "config">;

/**
 * Re-renders only when the widget's own identity, size or config change, never because it moved.
 * `WidgetView` validates the stored config against the widget's schema and isolates a crashing widget.
 */
const WidgetContent = memo(function WidgetContent({ id, widget, size, config }: WidgetContentProps) {
  return <WidgetView id={widget} size={size} config={config} instanceId={id} />;
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
  const lifted = useEditUi((s) => s.liftedId === placement.id);
  const [entering] = useState(() => bootSettled);
  const meta = widgetCatalog.get(live.widget);
  if (!meta && !editing) return null;

  const { w, h } = footprintOf(widgetCatalog, live);
  const tx = cellStartPx(live.x, metrics);
  const ty = cellStartPx(live.y, metrics);
  // Position is a direct transform (not a custom property) so a move never restyles the widget inside.
  const style = { "--w": w, "--h": h, transform: `translate3d(${tx}px, ${ty}px, 0)` } as CSSProperties;
  const name = meta?.name ?? "Unavailable widget";
  const label = `${name}, ${w} by ${h} cells, column ${live.x + 1}, row ${live.y + 1}`;
  const classes = [
    "overlay__slot",
    entering ? "is-entering" : "",
    editing ? "is-editing" : "",
    selected ? "is-selected" : "",
    gesture === "move" ? "is-dragging" : "",
    lifted && gesture !== "move" ? "is-lifted" : "",
  ];
  const resizable = (meta?.sizes.length ?? 0) > 1;

  return (
    <div
      className={classes.filter(Boolean).join(" ")}
      style={style}
      data-hit
      data-tx={tx}
      data-ty={ty}
      data-slot-id={placement.id}
      role={editing ? "group" : undefined}
      aria-roledescription={editing ? "widget" : undefined}
      aria-label={editing ? label : undefined}
      tabIndex={editing ? 0 : undefined}
      onContextMenu={(e) => onContextMenu(placement.id, e)}
    >
      <div className="overlay__content" aria-hidden={editing ? true : undefined}>
        {meta ? (
          <WidgetContent id={placement.id} widget={live.widget} size={live.size} config={live.config} />
        ) : (
          <div className="overlay__missing">
            <span className="caps">Unavailable</span>
            <span className="overlay__missing-id">{live.widget}</span>
          </div>
        )}
      </div>
      {editing ? (
        <Suspense fallback={null}>
          <SlotChrome id={placement.id} name={name} selected={selected} locked={locked} resizable={resizable} />
        </Suspense>
      ) : resizable && !locked ? (
        <span className="overlay__resize" data-resize-handle aria-hidden="true">
          <Icon name="resize" size={16} />
        </span>
      ) : null}
    </div>
  );
});
