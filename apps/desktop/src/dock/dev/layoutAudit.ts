/**
 * DEV ONLY. Pixel-precision checks of the dock as drawn: every edge on a whole device pixel, gaps equal to the spacing
 * token, text that fits its box, words centred on their tile, and nothing that moves when the pointer only hovers.
 * The checks are pure functions over measured boxes (tested in `layoutAudit.test.ts`); `auditDock` measures the live
 * page and is run by `tools/dock-tests/layout-audit.mjs` at 100 %, 125 % and 150 % scaling.
 */

export interface Box {
  readonly name: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface Finding {
  readonly check: "device-pixel" | "gap" | "overflow" | "centre" | "hover-shift";
  readonly name: string;
  readonly detail: string;
}

/** Below this, a difference is the browser's float noise, not a visible error (a fiftieth of a device pixel). */
export const PIXEL_TOLERANCE = 0.02;

const offGrid = (value: number, dpr: number): number => {
  const device = value * dpr;
  return Math.abs(device - Math.round(device));
};

/** Boxes whose edges do not fall on whole device pixels. */
export function deviceGrid(boxes: readonly Box[], dpr: number): Finding[] {
  return boxes.flatMap((b) => {
    const edges = { left: b.left, top: b.top, right: b.left + b.width, bottom: b.top + b.height };
    const bad = Object.entries(edges).filter(([, v]) => offGrid(v, dpr) > PIXEL_TOLERANCE);
    return bad.length === 0 ? [] : [{ check: "device-pixel" as const, name: b.name, detail: bad.map(([k, v]) => `${k} ${(v * dpr).toFixed(3)} device px`).join(", ") }];
  });
}

/** Neighbours along the dock whose gap is not the spacing token (within one device pixel's rounding). */
export function gaps(row: readonly Box[], vertical: boolean, gap: number, dpr: number): Finding[] {
  const sorted = [...row].sort((a, b) => (vertical ? a.top - b.top : a.left - b.left));
  const findings: Finding[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const a = sorted[i - 1] as Box;
    const b = sorted[i] as Box;
    const actual = vertical ? b.top - (a.top + a.height) : b.left - (a.left + a.width);
    if (Math.abs(actual - gap) > 1 / dpr + PIXEL_TOLERANCE) findings.push({ check: "gap", name: `${a.name} → ${b.name}`, detail: `${actual.toFixed(2)} px, token ${gap} px` });
  }
  return findings;
}

export interface TextBox {
  readonly name: string;
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/** Text cut off by its box: what the user cannot read. */
export function overflow(texts: readonly TextBox[]): Finding[] {
  return texts.flatMap((x) =>
    x.scrollWidth > x.clientWidth + 1 || x.scrollHeight > x.clientHeight + 1 ? [{ check: "overflow" as const, name: x.name, detail: `${x.scrollWidth}×${x.scrollHeight} in ${x.clientWidth}×${x.clientHeight}` }] : [],
  );
}

/** Content whose vertical centre is off its container's by more than half a device pixel. */
export function centred(pairs: readonly { readonly name: string; readonly outer: Box; readonly inner: Box }[], dpr: number): Finding[] {
  return pairs.flatMap(({ name, outer, inner }) => {
    const off = inner.top + inner.height / 2 - (outer.top + outer.height / 2);
    return Math.abs(off) > 0.5 / dpr + PIXEL_TOLERANCE ? [{ check: "centre" as const, name, detail: `${off.toFixed(2)} px off centre` }] : [];
  });
}

/** Boxes that moved between two measurements taken before and while the pointer hovers (magnification off). */
export function hoverShift(before: readonly Box[], after: readonly Box[]): Finding[] {
  const byName = new Map(after.map((b) => [b.name, b]));
  return before.flatMap((b) => {
    const a = byName.get(b.name);
    if (!a) return [];
    const moved = Math.max(Math.abs(a.left - b.left), Math.abs(a.top - b.top), Math.abs(a.width - b.width), Math.abs(a.height - b.height));
    return moved > PIXEL_TOLERANCE ? [{ check: "hover-shift" as const, name: b.name, detail: `moved ${moved.toFixed(2)} px` }] : [];
  });
}

const boxOf = (name: string, el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { name, left: r.left, top: r.top, width: r.width, height: r.height };
};

const nameOf = (el: Element, i: number): string => {
  const key = el.closest("[data-key]")?.getAttribute("data-key");
  return `${key ?? el.className.toString().split(" ")[0]}#${i}`;
};

const nextFrames = (count: number): Promise<void> =>
  new Promise((resolve) => {
    const tick = (left: number): void => {
      if (left === 0) resolve();
      else requestAnimationFrame(() => tick(left - 1));
    };
    tick(count);
  });

/** The settle time the audit gives the dock after it changes something, in frames. */
const SETTLE_FRAMES = 12;

/**
 * Measures the dock as drawn now and runs every check. `gap` is the spacing token in CSS px; the pointer is moved
 * over each item in turn to look for anything that shifts.
 */
export async function auditDock(gap: number, vertical: boolean): Promise<{ readonly dpr: number; readonly measured: number; readonly findings: Finding[] }> {
  const dpr = window.devicePixelRatio;
  const faces = [...document.querySelectorAll(".dock .face")].map((el, i) => boxOf(nameOf(el, i), el));
  const discs = [...document.querySelectorAll(".dock .disc, .dock .tile")].map((el, i) => boxOf(nameOf(el, i), el));
  const panels = [...document.querySelectorAll('.popover[data-open="true"], .menu')].map((el, i) => boxOf(nameOf(el, i), el));
  const texts = [...document.querySelectorAll(".dock .tile__title, .dock .tile__sub, .popover[data-open='true'] .tp-big, .menu__label")].map((el, i) => ({
    name: `${nameOf(el, i)} “${(el.textContent ?? "").slice(0, 24)}”`,
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  const centres = [...document.querySelectorAll(".dock .tile")].flatMap((tile, i) => {
    const inner = tile.querySelector(".tile__text, .tile__mark");
    return inner ? [{ name: nameOf(tile, i), outer: boxOf("tile", tile), inner: boxOf("inner", inner) }] : [];
  });
  const before = [...faces, ...discs];
  const shifts: Finding[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(".dock .disc, .dock .tile")) {
    const r = el.getBoundingClientRect();
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerType: "mouse" }));
    el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    await nextFrames(SETTLE_FRAMES);
    const after = [...document.querySelectorAll(".dock .face")].map((f, i) => boxOf(nameOf(f, i), f));
    shifts.push(...hoverShift(faces, after));
  }
  window.dispatchEvent(new PointerEvent("pointermove", { clientX: 0, clientY: 0, pointerType: "mouse" }));
  const findings = [
    ...deviceGrid([...before, ...panels], dpr),
    ...gaps(faces, vertical, gap, dpr),
    ...overflow(texts),
    ...centred(centres, dpr),
    ...dedupe(shifts),
  ];
  return { dpr, measured: before.length + panels.length + texts.length, findings };
}

function dedupe(findings: readonly Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.check}|${f.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
