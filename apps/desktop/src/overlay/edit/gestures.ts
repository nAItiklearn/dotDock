import { dragTarget, magnetize, passedDragThreshold, sizesByProximity } from "../../lib/layout/gesture";
import { cellStartPx, type GridMetrics } from "../../lib/layout/grid";
import { computeGuides } from "../../lib/layout/guides";
import { footprintOf, moveTo, rectOf, resizeTo } from "../../lib/layout/ops";
import type { LayoutStore } from "../../lib/state/layoutStore";
import type { AppSettings, Placement } from "../../lib/model/types";
import { widgetCatalog } from "../catalog";
import type { Handoff } from "../directPress";
import { announce, editUi } from "../editUi";

export interface GestureEnv {
  readonly root: HTMLElement;
  readonly layout: LayoutStore;
  readonly getMetrics: () => GridMetrics;
  readonly getSettings: () => AppSettings;
}

interface Active {
  readonly kind: "move" | "resize";
  readonly id: string;
  readonly pointerId: number;
  readonly el: HTMLElement;
  readonly startX: number;
  readonly startY: number;
  /** The layout when the gesture began; every preview is resolved from it, so moving away restores neighbours. */
  readonly base: readonly Placement[];
  readonly origin: Placement;
  started: boolean;
  lastKey: string;
  valid: readonly Placement[] | null;
  pointerX: number;
  pointerY: number;
  /** The offset (px) the dragged widget is drawn at: the pointer's, or pulled into line by the magnet. */
  shownX: number;
  shownY: number;
  /** True while `valid` is the resolution of the spot under the pointer (not an older, still-good one). */
  validHere: boolean;
  frame: number;
}

/** Transition used while the drop animation hands the final position over to the layout. */
const SCALE_ONLY_TRANSITION = "scale var(--dur-fast) var(--ease-out)";

/**
 * Pointer gestures for edit mode: drag to move, corner handle to resize.
 *
 * Everything on the hot path is a compositor property. The dragged widget follows the pointer through
 * the independent CSS `translate` property, written straight to the element once per animation frame;
 * React is only told when a neighbour has to move aside, and only those neighbours re-render. There is
 * no coarse grid: the widget goes where the pointer takes it, and a soft magnet lines it up with nearby
 * edges and centres.
 */
export class GestureController {
  private active: Active | null = null;

  constructor(private readonly env: GestureEnv) {}

  attach(): void {
    this.env.root.addEventListener("pointerdown", this.onPointerDown);
    this.env.root.addEventListener("focusin", this.onFocusIn);
    // Losing the window (another app took focus) ends the gesture, so the drag shield never outlives it.
    window.addEventListener("blur", this.onBlur);
  }

  detach(): void {
    this.cancel();
    this.env.root.removeEventListener("pointerdown", this.onPointerDown);
    this.env.root.removeEventListener("focusin", this.onFocusIn);
    window.removeEventListener("blur", this.onBlur);
  }

  /**
   * Continues a gesture that began on the plain desktop (press and hold, a drag, or the hover handle).
   * The pointer is already captured by the widget; nothing restarts, so the widget never jumps.
   */
  adopt(h: Handoff): void {
    const layout = this.env.layout.getState();
    const origin = layout.placements.find((p) => p.id === h.id);
    if (this.active || !origin || !h.el.hasPointerCapture(h.pointerId)) {
      h.el.classList.remove("is-dragging");
      h.el.style.translate = "0px 0px";
      editUi.setState({ activeId: null, gesture: null, liftedId: null });
      return;
    }
    this.active = {
      kind: h.kind,
      id: h.id,
      pointerId: h.pointerId,
      el: h.el,
      startX: h.startX,
      startY: h.startY,
      base: layout.placements,
      origin,
      // A widget already following the pointer has passed the threshold; it keeps going without a hitch.
      started: h.moving,
      lastKey: "",
      valid: null,
      pointerX: h.pointerX,
      pointerY: h.pointerY,
      shownX: h.pointerX - h.startX,
      shownY: h.pointerY - h.startY,
      validHere: false,
      frame: 0,
    };
    this.listen(h.el);
    if (h.moving) editUi.setState({ activeId: h.id, gesture: "move", liftedId: null });
    if (h.moving || h.kind === "resize") this.active.frame = requestAnimationFrame(this.onFrame);
  }

  /**
   * Clicking the empty desktop reaches Explorer, not the overlay (it is click-through there), so the only
   * sign of it is the window losing focus. That deselects, as a click on empty space does anywhere else.
   * Focus moves to the root, or the widget would take the selection back when the window is focused again.
   */
  private readonly onBlur = (): void => {
    this.cancel();
    const layout = this.env.layout.getState();
    if (!layout.editing || layout.selectedId === null) return;
    layout.select(null);
    this.env.root.focus({ preventScroll: true });
  };

  private listen(el: HTMLElement): void {
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointercancel", this.onPointerCancel);
    el.addEventListener("lostpointercapture", this.onPointerCancel);
  }

  get isActive(): boolean {
    return this.active?.started === true;
  }

  /** Abandons the gesture in flight; the widget glides back to where it was. */
  cancel(): void {
    if (this.active) this.finish(false);
  }

  private readonly onFocusIn = (e: FocusEvent): void => {
    const slot = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-slot-id]");
    const id = slot?.dataset["slotId"];
    if (id && this.env.layout.getState().selectedId !== id) this.env.layout.getState().select(id);
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    const layout = this.env.layout.getState();
    // A gesture whose release never reached us (it landed on another window) must not block every
    // later press: a new press means the old one is over.
    if (this.active && e.pointerId === this.active.pointerId) this.finish(this.active.started);
    if (e.button !== 0 || !layout.editing || this.active) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-no-drag]")) return;
    const slot = target.closest<HTMLElement>("[data-slot-id]");
    const id = slot?.dataset["slotId"];
    const origin = id ? layout.placements.find((p) => p.id === id) : undefined;
    if (!slot || !id || !origin) return;

    layout.select(id);
    slot.focus({ preventScroll: true });
    // Locked layouts still select and focus, but nothing moves.
    if (this.env.getSettings().layout.locked) return;
    e.preventDefault();

    slot.setPointerCapture(e.pointerId);
    this.active = {
      kind: target.closest("[data-resize-handle]") ? "resize" : "move",
      id,
      pointerId: e.pointerId,
      el: slot,
      startX: e.clientX,
      startY: e.clientY,
      base: layout.placements,
      origin,
      started: false,
      lastKey: "",
      valid: null,
      pointerX: e.clientX,
      pointerY: e.clientY,
      shownX: 0,
      shownY: 0,
      validHere: false,
      frame: 0,
    };
    this.listen(slot);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const a = this.active;
    if (!a || e.pointerId !== a.pointerId) return;
    if ((e.buttons & 1) === 0) {
      // Released somewhere we never heard about: end it where the pointer last was.
      this.finish(true);
      return;
    }
    a.pointerX = e.clientX;
    a.pointerY = e.clientY;
    // Pointer events can outrun the display; one update per frame is all anyone can see.
    if (a.frame === 0) a.frame = requestAnimationFrame(this.onFrame);
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (this.active && e.pointerId === this.active.pointerId) this.finish(true);
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    if (this.active && e.pointerId === this.active.pointerId) this.finish(false);
  };

  private readonly onFrame = (): void => {
    const a = this.active;
    if (!a) return;
    a.frame = 0;
    const dx = a.pointerX - a.startX;
    const dy = a.pointerY - a.startY;
    if (!a.started) {
      if (!passedDragThreshold(dx, dy)) return;
      a.started = true;
      editUi.setState({ activeId: a.id, gesture: a.kind, liftedId: null });
      if (a.kind === "move") a.el.classList.add("is-dragging");
    }
    if (a.kind === "move") {
      this.previewMove(a, dx, dy);
      a.el.style.translate = `${a.shownX}px ${a.shownY}px`;
    } else {
      this.previewResize(a);
    }
  };

  private previewMove(a: Active, dx: number, dy: number): void {
    const metrics = this.env.getMetrics();
    const ctx = this.env.layout.getState().context();
    const { w, h } = footprintOf(widgetCatalog, a.origin);
    const others = a.base.filter((p) => p.id !== a.id).map((p) => rectOf(widgetCatalog, p));
    const free = dragTarget(a.origin, dx, dy, metrics);
    const cell = magnetize({ ...free, w, h }, others, ctx.bounds, metrics);
    const key = `${cell.x},${cell.y}`;
    if (key !== a.lastKey) {
      a.lastKey = key;
      // A spot with no room keeps the last good preview rather than flickering.
      const next = moveTo(a.base, a.id, cell, ctx);
      a.validHere = next !== null;
      if (next) {
        a.valid = next;
        const moved = next.find((p) => p.id === a.id);
        const rect = moved ? rectOf(widgetCatalog, moved) : null;
        const settled = next.filter((p) => p.id !== a.id).map((p) => rectOf(widgetCatalog, p));
        editUi.setState({
          preview: this.changed(a, next, false),
          guides: rect && this.env.getSettings().layout.guides ? computeGuides(rect, settled) : [],
        });
      }
    }
    // Drawn where it will land (inside the screen, pulled by the magnet), so the drop never jumps.
    const landing = a.valid?.find((p) => p.id === a.id);
    if (landing && a.validHere) {
      a.shownX = cellStartPx(landing.x, metrics) - cellStartPx(a.origin.x, metrics);
      a.shownY = cellStartPx(landing.y, metrics) - cellStartPx(a.origin.y, metrics);
    } else {
      a.shownX = dx;
      a.shownY = dy;
    }
  }

  private previewResize(a: Active): void {
    const metrics = this.env.getMetrics();
    const meta = widgetCatalog.get(a.origin.widget);
    if (!meta) return;
    const wantW = a.pointerX - cellStartPx(a.origin.x, metrics);
    const wantH = a.pointerY - cellStartPx(a.origin.y, metrics);
    const ctx = this.env.layout.getState().context();
    for (const size of sizesByProximity(meta.sizes, wantW, wantH, metrics)) {
      const next = resizeTo(a.base, a.id, size.id, ctx);
      if (!next) continue;
      if (size.id === a.lastKey) return;
      a.lastKey = size.id;
      a.valid = next;
      editUi.setState({ preview: this.changed(a, next, true), guides: [] });
      return;
    }
  }

  /** Placements that differ from the layout at gesture start; the dragged widget only counts while resizing. */
  private changed(a: Active, next: readonly Placement[], includeActive: boolean): ReadonlyMap<string, Placement> {
    const before = new Map(a.base.map((p) => [p.id, p] as const));
    const diff = new Map<string, Placement>();
    for (const p of next) {
      if (p === before.get(p.id)) continue;
      if (p.id === a.id && !includeActive) continue;
      diff.set(p.id, p);
    }
    return diff;
  }

  private finish(commit: boolean): void {
    const a = this.active;
    if (!a) return;
    this.active = null;
    cancelAnimationFrame(a.frame);
    a.el.removeEventListener("pointermove", this.onPointerMove);
    a.el.removeEventListener("pointerup", this.onPointerUp);
    a.el.removeEventListener("pointercancel", this.onPointerCancel);
    a.el.removeEventListener("lostpointercapture", this.onPointerCancel);
    if (a.el.hasPointerCapture(a.pointerId)) a.el.releasePointerCapture(a.pointerId);

    const result = commit && a.started ? a.valid : null;
    if (a.started && a.kind === "move") this.settleMove(a, result);

    editUi.setState({ preview: null, activeId: null, gesture: null, liftedId: null, guides: [] });
    if (result) {
      this.env.layout.getState().commit(result);
      const done = result.find((p) => p.id === a.id);
      const name = widgetCatalog.get(a.origin.widget)?.name ?? "Widget";
      const changed = done && (a.kind === "move" ? done.x !== a.origin.x || done.y !== a.origin.y : done.size !== a.origin.size);
      if (done && changed) {
        const { w, h } = footprintOf(widgetCatalog, done);
        announce(
          a.kind === "move"
            ? `${name} moved to column ${done.x + 1}, row ${done.y + 1}`
            : `${name} resized to ${w} by ${h} cells`,
        );
      }
    }
  }

  /**
   * Hands the dragged element from "following the pointer" to "sitting in its cell" without a jump:
   * the committed position is written while the leftover distance is held in `translate`, which then
   * eases to zero. A cancelled drag just eases the whole offset back.
   */
  private settleMove(a: Active, result: readonly Placement[] | null): void {
    const el = a.el;
    const final = result?.find((p) => p.id === a.id);
    if (!final) {
      el.classList.remove("is-dragging");
      el.style.translate = "0px 0px";
      return;
    }
    const metrics = this.env.getMetrics();
    const residualX = cellStartPx(a.origin.x, metrics) + a.shownX - cellStartPx(final.x, metrics);
    const residualY = cellStartPx(a.origin.y, metrics) + a.shownY - cellStartPx(final.y, metrics);
    el.style.transition = SCALE_ONLY_TRANSITION;
    el.style.transform = `translate3d(${cellStartPx(final.x, metrics)}px, ${cellStartPx(final.y, metrics)}px, 0)`;
    el.style.translate = `${residualX}px ${residualY}px`;
    el.classList.remove("is-dragging");
    void el.offsetWidth; // flush so the jump above is committed before transitions come back
    el.style.transition = "";
    el.style.translate = "0px 0px";
  }
}
