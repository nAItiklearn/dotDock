/** Small DOM helpers shared by the page scripts. */

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Looks up an element by selector and throws a readable error if the markup is missing it. */
export function requireEl<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

export function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Fires `callback` whenever the page theme changes (the data-theme attribute on <html>). */
export function onThemeChange(callback: () => void): void {
  new MutationObserver(callback).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
}

/** Calls `callback` every time the wall clock crosses the start of a second. */
export function everySecond(callback: (now: Date) => void): () => void {
  let timer = 0;
  const tick = (): void => {
    const now = new Date();
    callback(now);
    timer = window.setTimeout(tick, 1000 - (now.getTime() % 1000) + 5);
  };
  tick();
  return () => window.clearTimeout(timer);
}
