import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import { cellStartPx, type GridMetrics } from "../../lib/layout/grid";
import type { Guide } from "../../lib/layout/guides";
import { footprintOf } from "../../lib/layout/ops";
import { getApp } from "../../lib/state/app";
import { useSettingsStore } from "../../lib/state/hooks";
import { widgetCatalog } from "../catalog";
import { announce, editUi, useEditUi } from "../editUi";
import { takeHandoff } from "../directPress";
import { removeWithExit } from "../directActions";
import { Drawer } from "./Drawer";
import { GestureController } from "./gestures";
import { Toolbar } from "./Toolbar";
import { UndoToast } from "./UndoToast";
import "./edit.css";
import { isKey } from "./keys";

/** Keys that belong to the control that has focus, not to the layout. */
const OWN_KEYS_SELECTOR = "input, select, textarea, [role='radio'], [role='slider'], [contenteditable='true']";

function guideStyle(g: Guide, m: GridMetrics): CSSProperties {
  const along = (cell: number): number => cellStartPx(cell, m);
  const at = g.edge === "start" ? along(g.at) : g.edge === "end" ? along(g.at) - m.gap : along(g.at) - m.gap / 2;
  const from = along(g.from);
  const length = along(g.to) - m.gap - from;
  return g.axis === "x"
    ? { transform: `translate3d(${at}px, ${from}px, 0)`, height: length }
    : { transform: `translate3d(${from}px, ${at}px, 0)`, width: length };
}

export interface EditLayerProps {
  readonly rootRef: RefObject<HTMLElement | null>;
  readonly metrics: GridMetrics;
  readonly openSettings: () => void;
}

/**
 * Everything that exists only while editing: gestures, keyboard, toolbar, drawer, guides and the
 * drag shield. Loaded as its own chunk, so the always-on desktop path carries none of it.
 */
export function EditLayer({ rootRef, metrics, openSettings }: EditLayerProps) {
  const app = getApp();
  const drawerOpen = useEditUi((s) => s.drawerOpen);
  const gesture = useEditUi((s) => s.gesture);
  const guides = useEditUi((s) => s.guides);
  const showGuides = useSettingsStore((s) => s.settings.layout.guides);
  const controller = useRef<GestureController | null>(null);
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const gestures = new GestureController({
      root,
      layout: app.layout,
      getMetrics: () => metricsRef.current,
      getSettings: () => app.settings.getState().settings,
    });
    gestures.attach();
    controller.current = gestures;
    // A press and hold or drag on the plain desktop started edit mode; carry on with that same gesture.
    const handoff = takeHandoff();
    if (handoff) gestures.adopt(handoff);
    // Picking a widget while the drawer is open shows its options.
    const onPick = (e: PointerEvent): void => {
      if ((e.target as HTMLElement).closest("[data-slot-id]") && editUi.getState().drawerOpen) {
        editUi.setState({ drawerTab: "selected" });
      }
    };
    root.addEventListener("pointerdown", onPick);
    return () => {
      root.removeEventListener("pointerdown", onPick);
      gestures.detach();
      controller.current = null;
    };
  }, [app, rootRef]);

  useEffect(() => {
    const layout = app.layout;
    const onKey = (e: KeyboardEvent): void => {
      const state = layout.getState();
      if (!state.editing) return;
      const target = e.target as HTMLElement;
      const inControl = target.closest(OWN_KEYS_SELECTOR) !== null;
      const mod = e.ctrlKey || e.metaKey;

      if (e.key === "Escape") {
        e.preventDefault();
        if (controller.current?.isActive) controller.current.cancel();
        else if (editUi.getState().drawerOpen) editUi.setState({ drawerOpen: false, addAt: null });
        else void state.exitEdit();
        return;
      }
      if (mod && !e.altKey && isKey(e, "z")) {
        e.preventDefault();
        editUi.setState({ undoToast: null });
        if (e.shiftKey) state.redo();
        else state.undo();
        return;
      }
      if (mod && !e.altKey && isKey(e, "y")) {
        e.preventDefault();
        state.redo();
        return;
      }
      const id = state.selectedId;
      if (inControl || !id || e.altKey) return;
      const name = widgetCatalog.get(state.placements.find((p) => p.id === id)?.widget ?? "")?.name ?? "Widget";

      if (mod && isKey(e, "d")) {
        e.preventDefault();
        if (state.duplicate(id).ok) announce(`${name} duplicated`);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        void removeWithExit(layout, id, name);
      } else if (e.key === "=" || e.key === "+" || e.key === "-") {
        e.preventDefault();
        const result = state.stepSize(id, e.key === "-" ? -1 : 1);
        const moved = layout.getState().placements.find((p) => p.id === id);
        if (result.ok && moved) {
          const { w, h } = footprintOf(widgetCatalog, moved);
          announce(`${name} resized to ${w} by ${h} cells`);
        }
      } else if (e.key.startsWith("Arrow") && !mod) {
        e.preventDefault();
        const step = e.key === "ArrowLeft" ? [-1, 0] : e.key === "ArrowRight" ? [1, 0] : e.key === "ArrowUp" ? [0, -1] : [0, 1];
        const result = state.nudge(id, step[0] ?? 0, step[1] ?? 0);
        const placed = layout.getState().placements.find((p) => p.id === id);
        if (result.ok && placed) announce(`${name} moved to column ${placed.x + 1}, row ${placed.y + 1}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [app]);

  return (
    <>
      {showGuides
        ? guides.map((g) => <div key={`${g.axis}${g.edge}${g.at}`} className={`guide guide--${g.axis}`} style={guideStyle(g, metrics)} aria-hidden="true" />)
        : null}
      <UndoToast />
      <Toolbar openSettings={openSettings} />
      {drawerOpen ? <Drawer metrics={metrics} /> : null}
      {gesture ? <div className="drag-shield" data-hit aria-hidden="true" /> : null}
    </>
  );
}
