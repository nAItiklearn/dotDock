import { classifyPress, DRAG_THRESHOLD_PX, HOLD_MS, passedDragThreshold } from "../lib/layout/gesture";
import type { LayoutStore } from "../lib/state/layoutStore";
import type { AppSettings } from "../lib/model/types";
import { editUi } from "./editUi";

/**
 * Targets inside a widget that keep their own pointer behaviour: a press there is the widget's,
 * never the start of a move. Widgets can opt any element in with `data-no-drag`.
 */
export const OWN_POINTER_SELECTOR =
  "button, a[href], input, select, textarea, label, [role='button'], [role='slider'], [role='switch'], [contenteditable='true'], [draggable='true'], [data-no-drag]";

/** A gesture recognised on the plain desktop, handed to edit mode's gesture controller once it has loaded. */
export interface Handoff {
  readonly kind: "move" | "resize";
  readonly id: string;
  readonly pointerId: number;
  readonly el: HTMLElement;
  readonly startX: number;
  readonly startY: number;
  pointerX: number;
  pointerY: number;
  /** True once the pointer has travelled far enough to be moving the widget (a hold lifts it first). */
  moving: boolean;
}

let pending: Handoff | null = null;
let releasePending: (() => void) | null = null;

/** Ends a gesture nobody adopted: the widget eases back to its cell and loses the lift. */
function settle(h: Handoff): void {
  h.el.style.translate = "0px 0px";
  editUi.setState({ activeId: null, gesture: null, liftedId: null });
  if (pending === h) {
    pending = null;
    releasePending = null;
  }
}

/** Takes the gesture in flight, if any, so exactly one controller drives it from here on. */
export function takeHandoff(): Handoff | null {
  const h = pending;
  pending = null;
  releasePending?.();
  releasePending = null;
  return h;
}

export interface DirectPressEnv {
  readonly root: HTMLElement;
  readonly layout: LayoutStore;
  readonly getSettings: () => AppSettings;
  /** Loads edit mode's code ahead of need; the first lift should never wait on a download. */
  readonly warm: () => void;
}

interface Press {
  readonly kind: "move" | "resize";
  readonly id: string;
  readonly pointerId: number;
  readonly el: HTMLElement;
  readonly startX: number;
  readonly startY: number;
  readonly startedAt: number;
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Press and hold, or drag, on a widget on the plain desktop to move it; drag its corner handle to resize.
 * A plain click is left to the widget. Once a gesture is recognised, edit mode starts with the pointer
 * still down and its gesture controller adopts the gesture (`takeHandoff`), so the move never restarts.
 */
export class DirectPress {
  private press: Press | null = null;
  private handoff: Handoff | null = null;

  constructor(private readonly env: DirectPressEnv) {}

  attach(): void {
    this.env.root.addEventListener("pointerdown", this.onDown);
  }

  detach(): void {
    this.clear();
    this.env.root.removeEventListener("pointerdown", this.onDown);
  }

  private readonly onDown = (e: PointerEvent): void => {
    const layout = this.env.layout.getState();
    if (e.button !== 0 || layout.editing || this.press || this.env.getSettings().layout.locked) return;
    const target = e.target as HTMLElement;
    const slot = target.closest<HTMLElement>("[data-slot-id]");
    const id = slot?.dataset["slotId"];
    if (!slot || !id || !layout.placements.some((p) => p.id === id)) return;
    const onHandle = target.closest("[data-resize-handle]") !== null;
    if (!onHandle && target.closest(OWN_POINTER_SELECTOR)) return;
    if (onHandle) e.preventDefault();
    this.env.warm();
    const kind = onHandle ? "resize" : "move";
    this.press = { kind, id, pointerId: e.pointerId, el: slot, startX: e.clientX, startY: e.clientY, startedAt: e.timeStamp, x: e.clientX, y: e.clientY, timer: null };
    // A handle is an explicit control: it resizes on movement and has no hold.
    if (kind === "move") this.press.timer = setTimeout(this.onHoldTimer, HOLD_MS);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onCancel);
    window.addEventListener("blur", this.onCancel);
  };

  private readonly onHoldTimer = (): void => {
    const p = this.press;
    if (!p) return;
    p.timer = null;
    if (classifyPress(HOLD_MS, p.x - p.startX, p.y - p.startY) === "hold") this.begin(false);
  };

  private readonly onMove = (e: PointerEvent): void => {
    const h = this.handoff;
    if (h && e.pointerId === h.pointerId) {
      // Edit mode is still loading: keep the widget under the pointer until the controller takes over.
      h.pointerX = e.clientX;
      h.pointerY = e.clientY;
      const dx = e.clientX - h.startX;
      const dy = e.clientY - h.startY;
      if (h.kind === "move" && (h.moving || passedDragThreshold(dx, dy))) {
        if (!h.moving) editUi.setState({ activeId: h.id, gesture: "move", liftedId: null });
        h.moving = true;
        h.el.style.translate = `${dx}px ${dy}px`;
      }
      return;
    }
    const p = this.press;
    if (!p || e.pointerId !== p.pointerId) return;
    p.x = e.clientX;
    p.y = e.clientY;
    const dx = p.x - p.startX;
    const dy = p.y - p.startY;
    if (p.kind === "resize") {
      if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) this.begin(true);
      return;
    }
    const intent = classifyPress(e.timeStamp - p.startedAt, dx, dy);
    if (intent === "drag") this.begin(true);
    else if (intent === "none" && p.timer) {
      // Wandered off a hold: from here only a real drag counts.
      clearTimeout(p.timer);
      p.timer = null;
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    const h = this.handoff;
    if (h && e.pointerId === h.pointerId) {
      // Released before edit mode loaded: the widget glides back and stays selected in edit mode.
      settle(h);
    }
    this.clear();
  };

  private readonly onCancel = (): void => {
    const h = this.handoff;
    if (h) {
      settle(h);
      void this.env.layout.getState().exitEdit();
    }
    this.clear();
  };

  /** The press is a gesture: take the pointer, start edit mode, and leave the gesture for its controller. */
  private begin(moving: boolean): void {
    const p = this.press;
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    this.press = null;
    try {
      p.el.setPointerCapture(p.pointerId);
    } catch {
      // The pointer is already gone (released in the same frame); the gesture ends with it.
      this.clear();
      return;
    }
    window.getSelection()?.removeAllRanges();
    const h: Handoff = { kind: p.kind, id: p.id, pointerId: p.pointerId, el: p.el, startX: p.startX, startY: p.startY, pointerX: p.x, pointerY: p.y, moving: moving && p.kind === "move" };
    if (p.kind === "move") {
      editUi.setState(h.moving ? { activeId: p.id, gesture: "move", liftedId: null } : { liftedId: p.id });
    }
    if (h.moving) p.el.style.translate = `${p.x - p.startX}px ${p.y - p.startY}px`;
    this.handoff = h;
    pending = h;
    releasePending = () => this.clear();
    this.env.layout.getState().enterEdit(p.id);
  }

  private clear(): void {
    if (this.press?.timer) clearTimeout(this.press.timer);
    this.press = null;
    this.handoff = null;
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onCancel);
    window.removeEventListener("blur", this.onCancel);
  }
}
