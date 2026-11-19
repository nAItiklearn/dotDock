/**
 * DEV ONLY. Measurement helpers for docs/design/DOCK_BENCHMARK.md, reachable as `window.dockDev.perf` in the
 * fixture build. They drive the real dock with synthetic pointer events; nothing here ships.
 */
export interface Stats {
  readonly n: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

function stats(values: readonly number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  const round = (n: number): number => Math.round(n * 100) / 100;
  return { n: sorted.length, p50: round(at(0.5)), p95: round(at(0.95)), p99: round(at(0.99)), max: round(sorted[sorted.length - 1] ?? 0) };
}

const SWEEP_FRAMES_PER_PASS = 90;
const FRAME_MS = 1000 / 60;
const SWEEP_PERIOD_MS = 1500;
const EDGE_INSET = 24;

interface Sweep {
  readonly x0: number;
  readonly x1: number;
  readonly y: number;
}

function sweepGeometry(): Sweep {
  const bar = document.querySelector(".dock")?.getBoundingClientRect();
  if (!bar) throw new Error("no dock on the page");
  return { x0: bar.left + EDGE_INSET, x1: bar.right - EDGE_INSET, y: bar.top + bar.height / 2 };
}

const move = (x: number, y: number): void => {
  window.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y, pointerType: "mouse" }));
};

const yieldToTask = (): Promise<void> =>
  new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });

const triangle = (phase: number): number => {
  const p = phase % 2;
  return p < 1 ? p : 2 - p;
};

export const perf = {
  /** Frame cadence while the pointer sweeps the dock for `durationMs`; needs the page in the foreground. */
  async frames(durationMs: number): Promise<Stats & { readonly over20: number; readonly longTasks: number }> {
    const { x0, x1, y } = sweepGeometry();
    const deltas: number[] = [];
    let longTasks = 0;
    const observer = new PerformanceObserver((list) => {
      longTasks += list.getEntries().length;
    });
    observer.observe({ type: "longtask" });
    let last = performance.now();
    const start = last;
    await new Promise<void>((resolve) => {
      const frame = (now: number): void => {
        deltas.push(now - last);
        last = now;
        const elapsed = now - start;
        move(x0 + (x1 - x0) * triangle(elapsed / SWEEP_PERIOD_MS), y);
        if (elapsed < durationMs) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    observer.disconnect();
    move(0, 0);
    deltas.shift();
    return { ...stats(deltas), over20: deltas.filter((d) => d > 20).length, longTasks };
  },

  /**
   * Main-thread work per frame with the frame loop driven by hand, so the numbers do not depend on vsync:
   * the engine's tick, forced style and layout, and the React work the hover changes cause.
   */
  async work(frames: number): Promise<{ readonly total: Stats; readonly engineAndStyle: Stats; readonly react: Stats }> {
    const { x0, x1, y } = sweepGeometry();
    const realRaf = window.requestAnimationFrame;
    let queue: FrameRequestCallback[] = [];
    window.requestAnimationFrame = (callback: FrameRequestCallback): number => queue.push(callback);
    const total: number[] = [];
    const engine: number[] = [];
    const react: number[] = [];
    let now = performance.now();
    try {
      for (let i = 0; i < frames; i++) {
        now += FRAME_MS;
        const started = performance.now();
        move(x0 + (x1 - x0) * triangle(i / SWEEP_FRAMES_PER_PASS), y);
        const due = queue;
        queue = [];
        due.forEach((callback) => callback(now));
        void document.documentElement.getBoundingClientRect();
        const laidOut = performance.now();
        await yieldToTask();
        const done = performance.now();
        engine.push(laidOut - started);
        react.push(done - laidOut);
        total.push(done - started);
      }
    } finally {
      window.requestAnimationFrame = realRaf;
      move(0, 0);
    }
    return { total: stats(total), engineAndStyle: stats(engine), react: stats(react) };
  },
};
