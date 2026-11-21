import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(() => Promise.resolve(null)));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../providers/bridge", () => ({ isTauri: () => true }));

const { syncHitRegions } = await import("./nativeHost");

/** A panel whose box moves while it animates in, as `.drawer__panel` and `.undo-toast` do. */
class Panel {
  readonly dataset: Record<string, string> = {};
  left = 0;
  readonly offsetWidth = 0;
  readonly offsetHeight = 0;
  getBoundingClientRect() {
    return { left: this.left, top: 100, width: 300, height: 600 };
  }
}

class Root extends EventTarget {
  constructor(readonly panels: Panel[]) {
    super();
  }
  querySelectorAll() {
    return this.panels;
  }
}

let frames: FrameRequestCallback[] = [];
const runFrames = (): void => {
  const due = frames;
  frames = [];
  due.forEach((f) => f(0));
};
const pushed = (): unknown[] => invoke.mock.calls.filter(([cmd]) => cmd === "set_hit_regions").map(([, args]) => args?.["rects"]);

beforeEach(() => {
  invoke.mockClear();
  frames = [];
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => frames.push(f));
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal(
    "MutationObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("hit regions follow panels that animate into place", () => {
  it("measures again when the entry animation ends, so the panel's resting edge takes clicks", () => {
    const drawer = new Panel();
    drawer.left = 1024; // first frame: still slid out to the right
    const root = new Root([drawer]);
    const stop = syncHitRegions(root as unknown as HTMLElement);
    runFrames();
    drawer.left = 1000; // the slide-in has finished
    root.dispatchEvent(new Event("animationend"));
    runFrames();
    const [first, last] = pushed() as { x: number }[][];
    expect(first?.[0]?.x).toBeGreaterThan(1000);
    expect(last?.[0]?.x).toBeLessThan(1000);
    stop();
  });

  it("stops listening once detached", () => {
    const panel = new Panel();
    const root = new Root([panel]);
    const stop = syncHitRegions(root as unknown as HTMLElement);
    runFrames();
    stop();
    panel.left = 40;
    root.dispatchEvent(new Event("transitionend"));
    runFrames();
    expect(pushed()).toHaveLength(1);
  });
});
