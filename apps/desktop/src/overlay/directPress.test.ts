import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DIRECT_DRAG_PX, HOLD_MS } from "../lib/layout/gesture";
import { defaultLayoutDoc } from "../lib/model/defaults";
import { createApp, type AppContext } from "../lib/state/app";
import { MemoryBackend } from "../lib/storage/backend";
import { widgetCatalog } from "./catalog";
import { DirectPress, takeHandoff } from "./directPress";
import { GestureController } from "./edit/gestures";
import { editUi, resetEditUi } from "./editUi";

/**
 * A minimal stand-in for the DOM the press logic touches: elements are event targets with the few
 * properties it reads, and `closest` answers from what the element is (slot, resize handle, button).
 */
class FakeEl extends EventTarget {
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  readonly classList = {
    set: new Set<string>(),
    add: (...c: string[]) => c.forEach((x) => this.classList.set.add(x)),
    remove: (...c: string[]) => c.forEach((x) => this.classList.set.delete(x)),
    contains: (c: string) => this.classList.set.has(c),
  };
  captured: number | null = null;
  offsetWidth = 0;
  constructor(
    private readonly slot: FakeEl | null,
    private readonly role: "slot" | "handle" | "button",
  ) {
    super();
  }
  closest(selector: string): FakeEl | null {
    if (selector.includes("data-slot-id")) return this.role === "slot" ? this : this.slot;
    if (selector.includes("data-resize-handle")) return this.role === "handle" ? this : null;
    if (selector.includes("data-no-drag") && this.role === "button") return this;
    return null;
  }
  focus(): void {}
  setPointerCapture(id: number): void {
    this.captured = id;
  }
  hasPointerCapture(id: number): boolean {
    return this.captured === id;
  }
  releasePointerCapture(): void {
    this.captured = null;
  }
}

function fire(on: EventTarget, type: string, target: EventTarget, props: Record<string, number>, timeStamp: number): void {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { button: 0, pointerId: 1, ...props });
  Object.defineProperty(e, "target", { value: target });
  Object.defineProperty(e, "timeStamp", { value: timeStamp });
  on.dispatchEvent(e);
}

const metrics = { cell: 76, gap: 12, edge: 28 };
/** Where the shipped Work layout puts the RAM card the gestures pick up. */
const SYSTEM_HOME_X = defaultLayoutDoc("work").monitors["primary"]?.placements.find((p) => p.id === "system-1")?.x ?? Number.NaN;
let app: AppContext;
let root: FakeEl;
let slot: FakeEl;
let press: DirectPress;

beforeEach(async () => {
  vi.useFakeTimers();
  const win = new EventTarget() as EventTarget & { getSelection: () => null };
  win.getSelection = () => null;
  vi.stubGlobal("window", win);
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 16));
  vi.stubGlobal("cancelAnimationFrame", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  const bus = { send: () => undefined, subscribe: () => () => undefined };
  app = createApp({ catalog: widgetCatalog, backend: new MemoryBackend(), bus });
  await app.start();
  app.layout.getState().setBounds({ cols: 16, rows: 9 });
  root = new FakeEl(null, "slot");
  slot = new FakeEl(null, "slot");
  slot.dataset["slotId"] = "system-1";
  press = new DirectPress({
    root: root as unknown as HTMLElement,
    layout: app.layout,
    getSettings: () => app.settings.getState().settings,
    warm: () => undefined,
  });
  press.attach();
});

afterEach(() => {
  press.detach();
  takeHandoff();
  resetEditUi();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const down = (target: FakeEl, x = 100, y = 100): void => fire(root, "pointerdown", target, { clientX: x, clientY: y }, 0);
const move = (x: number, y: number, t: number, buttons = 1): void => fire(window, "pointermove", slot, { clientX: x, clientY: y, buttons }, t);
const up = (x: number, y: number, t: number): void => fire(window, "pointerup", slot, { clientX: x, clientY: y }, t);

describe("pressing a widget on the plain desktop", () => {
  it("leaves a plain click to the widget: no edit mode, nothing lifted", () => {
    down(slot);
    vi.advanceTimersByTime(HOLD_MS / 2);
    up(100, 100, HOLD_MS / 2);
    vi.advanceTimersByTime(HOLD_MS);
    expect(app.layout.getState().editing).toBe(false);
    expect(editUi.getState().liftedId).toBeNull();
  });

  it("lifts the widget after a still hold and opens edit mode with it selected", () => {
    down(slot);
    vi.advanceTimersByTime(HOLD_MS);
    expect(app.layout.getState()).toMatchObject({ editing: true, selectedId: "system-1" });
    expect(editUi.getState().liftedId).toBe("system-1");
    expect(slot.captured).toBe(1);
  });

  it("releasing a hold before edit mode loads settles the widget and leaves no drag in flight", () => {
    down(slot);
    vi.advanceTimersByTime(HOLD_MS);
    up(100, 100, HOLD_MS + 10);
    expect(editUi.getState()).toMatchObject({ liftedId: null, gesture: null, activeId: null });
    expect(takeHandoff()).toBeNull();
  });

  it("a real drag starts moving at once and follows the pointer", () => {
    down(slot);
    move(100 + DIRECT_DRAG_PX + 20, 100, 30);
    expect(app.layout.getState().editing).toBe(true);
    expect(editUi.getState()).toMatchObject({ activeId: "system-1", gesture: "move" });
    move(150, 140, 60);
    expect(slot.style["translate"]).toBe("50px 40px");
  });

  it("a release that landed on another window ends the press: a later bare move never starts a drag", () => {
    down(slot);
    move(106, 100, 20);
    // The pointerup went to the app under the click-through overlay; the next move has no button held.
    move(160, 100, 400, 0);
    move(200, 100, 420, 0);
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(app.layout.getState().editing).toBe(false);
    down(slot);
    vi.advanceTimersByTime(HOLD_MS);
    expect(app.layout.getState().editing).toBe(true);
  });

  it("never starts from a control inside the widget", () => {
    down(new FakeEl(slot, "button"));
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(app.layout.getState().editing).toBe(false);
  });

  it("does nothing while the layout is locked", () => {
    app.settings.getState().update((s) => ({ ...s, layout: { ...s.layout, locked: true } }));
    down(slot);
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(app.layout.getState().editing).toBe(false);
  });

  it("losing the window mid-gesture (another app took focus) ends edit mode and clears the drag", async () => {
    down(slot);
    move(140, 100, 30);
    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(0);
    expect(app.layout.getState().editing).toBe(false);
    expect(editUi.getState()).toMatchObject({ gesture: null, activeId: null, liftedId: null });
  });
});

describe("edit mode carries the gesture on", () => {
  function controller(): GestureController {
    const c = new GestureController({
      root: root as unknown as HTMLElement,
      layout: app.layout,
      getMetrics: () => metrics,
      getSettings: () => app.settings.getState().settings,
    });
    c.attach();
    const handoff = takeHandoff();
    if (!handoff) throw new Error("no gesture was handed over");
    c.adopt(handoff);
    return c;
  }

  it("drops where the pointer let go, freely, and the drag shield goes with the pointer", () => {
    down(slot);
    move(100 + DIRECT_DRAG_PX + 36, 100, 30);
    const c = controller();
    fire(slot, "pointermove", slot, { clientX: 100 + 44, clientY: 100, buttons: 1 }, 60);
    vi.advanceTimersByTime(20);
    fire(slot, "pointerup", slot, { clientX: 144, clientY: 100 }, 80);
    expect(editUi.getState().gesture).toBeNull();
    const moved = app.layout.getState().placements.find((p) => p.id === "system-1");
    // Half a pitch (44 px) is half a cell: no jump to a whole cell.
    expect(moved?.x).toBe(SYSTEM_HOME_X + 0.5);
    c.detach();
  });

  it("a drag whose release never arrived does not block the next press in edit mode", () => {
    down(slot);
    move(140, 100, 30);
    const c = controller();
    // No pointerup reached the overlay. The user presses again: that press must be heard.
    fire(root, "pointerdown", slot, { clientX: 300, clientY: 300 }, 500);
    expect(editUi.getState().gesture).toBeNull();
    fire(slot, "pointerup", slot, { clientX: 300, clientY: 300 }, 520);
    expect(app.layout.getState().selectedId).toBe("system-1");
    c.detach();
  });

  it("a click on the empty desktop deselects: the selection never stays stuck on a widget", () => {
    down(slot);
    move(140, 100, 30);
    const c = controller();
    fire(slot, "pointerup", slot, { clientX: 140, clientY: 100 }, 60);
    expect(app.layout.getState().selectedId).toBe("system-1");
    let focusedRoot = false;
    root.focus = () => {
      focusedRoot = true;
    };
    // The click landed on Explorer's desktop; all the overlay sees is its window losing focus.
    window.dispatchEvent(new Event("blur"));
    expect(app.layout.getState().selectedId).toBeNull();
    expect(app.layout.getState().editing).toBe(true);
    // Focus left the widget, so focusing the window again does not select it back.
    expect(focusedRoot).toBe(true);
    c.detach();
  });

  it("another app taking focus cancels the drag: the widget goes home, no full-screen hit area remains", () => {
    down(slot);
    move(140, 100, 30);
    const c = controller();
    window.dispatchEvent(new Event("blur"));
    expect(editUi.getState().gesture).toBeNull();
    expect(app.layout.getState().placements.find((p) => p.id === "system-1")?.x).toBe(SYSTEM_HOME_X);
    c.detach();
  });
});
