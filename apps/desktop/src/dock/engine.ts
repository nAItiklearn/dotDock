import { computeMagnify, type MagnifyFrame, type RestItem } from "./magnify";
import type { DockEdge } from "./protocol";
import { isSettled, omegaForSettle, rest, stepCritical, type SpringState } from "./spring";

/** How long each spring takes to settle (2 %). All of them are critically damped: no overshoot. */
export const SETTLE_MS = { engage: 180, slide: 230, appear: 260 } as const;
/** Scale of an item while it is carried in edit mode. */
const DRAG_SCALE = 1.1;
/** Items fade and grow from this scale when they join the dock. */
const APPEAR_FROM = 0.7;
/** Longest step the springs take; a stalled frame must not teleport anything. */
const MAX_STEP_S = 1 / 30;
const FIRST_STEP_S = 1 / 60;
/** Below this distance (px) a spring counts as having arrived; unit-less springs use a tenth of it. */
const EPSILON = 0.02;
/** Smallest scale change worth writing. */
const SCALE_STEP = 1e-4;

const OMEGA = {
  engage: omegaForSettle(SETTLE_MS.engage),
  slide: omegaForSettle(SETTLE_MS.slide),
  appear: omegaForSettle(SETTLE_MS.appear),
};

export interface LayoutItem {
  readonly key: string;
  /** The item's face: scaled and moved by the engine. */
  readonly el: HTMLElement;
  /** The running dots under the item: moved with it, never scaled. */
  readonly dots: HTMLElement | null;
  /** Rest span along the axis, in dock-local px. */
  readonly start: number;
  readonly size: number;
  readonly magnifies: boolean;
}

export interface Layout {
  readonly items: readonly LayoutItem[];
  /** The bar's own rest span along the axis, in dock-local px. */
  readonly barStart: number;
  readonly barSize: number;
  /** Window coordinate of dock-local 0 along the axis. */
  readonly origin: number;
}

export interface EngineConfig {
  readonly peak: number;
  /** Distance from the pointer at which magnification fades out, in px. */
  readonly reach: number;
  readonly gap: number;
  readonly edge: DockEdge;
  /** Reduced motion: no magnification, and everything lands in place at once. */
  readonly reduced: boolean;
}

interface ItemState extends LayoutItem {
  /** Spring offset from the rest place: edit-mode slides and rebases after the layout changed. */
  off: SpringState;
  appear: SpringState;
  slideTarget: number;
  /** Total translation last applied, in px along the axis. */
  shift: number;
  written: string;
  writtenDots: string;
}

interface DragState {
  readonly key: string;
  /** Distance from the item's start to where the pointer took hold. */
  readonly grab: number;
  /** Pointer along the axis, window px. */
  pointer: number;
}

const isVertical = (edge: DockEdge): boolean => edge === "left" || edge === "right";
/** +1 when the screen's inside is towards larger coordinates, -1 otherwise. */
const insideSign = (edge: DockEdge): 1 | -1 => (edge === "top" || edge === "left" ? 1 : -1);
const px = (n: number): string => String(Math.round(n * 100) / 100);

/**
 * Drives the dock's per-frame motion with transforms only: magnification, the bar growing with it, items
 * sliding aside for edit-mode drags and for items that join or leave. React renders the structure; this class
 * is the only writer of the items' transforms, and it stops asking for frames the moment everything has settled.
 */
export class DockEngine {
  private items: ItemState[] = [];
  private config: EngineConfig;
  private origin = 0;
  private barStart = 0;
  private barSize = 0;
  private bar: HTMLElement | null = null;
  private barOff: { start: SpringState; end: SpringState } = { start: { x: 0, v: 0 }, end: { x: 0, v: 0 } };
  /** Window coordinates of the bar's two ends as last drawn. */
  private barDrawn = { start: 0, end: 0 };
  private barWritten = "";
  private label: HTMLElement | null = null;
  private labelWritten = "";
  private pointer: number | null = null;
  private engage: SpringState = { x: 0, v: 0 };
  private drag: DragState | null = null;
  private raf = 0;
  private last = 0;
  private hoveredKey: string | null = null;
  private readonly onHover: (key: string | null) => void;

  constructor(config: EngineConfig, onHover: (key: string | null) => void) {
    this.config = config;
    this.onHover = onHover;
  }

  configure(config: EngineConfig): void {
    if (config.edge !== this.config.edge) {
      this.barWritten = "";
      this.labelWritten = "";
      for (const item of this.items) {
        item.written = "";
        item.writtenDots = "";
      }
    }
    this.config = config;
    this.kick();
  }

  attachBar(el: HTMLElement | null): void {
    this.bar = el;
    this.barWritten = "";
  }

  attachLabel(el: HTMLElement | null): void {
    this.label = el;
    this.labelWritten = "";
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** The pointer's position along the axis in window px, or null when it is not over the dock. */
  setPointer(main: number | null): void {
    this.pointer = main;
    this.kick();
  }

  /**
   * Called after every render. Items that were already on the dock keep the place they are drawn at and glide
   * to their new rest place; items that join grow in.
   */
  setLayout(layout: Layout): void {
    const before = new Map(this.items.map((item) => [item.key, item]));
    const firstLayout = this.items.length === 0;
    const previousOrigin = this.origin;
    const next: ItemState[] = layout.items.map((item) => ({
      ...item,
      off: { x: 0, v: 0 },
      appear: { x: 1, v: 0 },
      slideTarget: 0,
      shift: 0,
      written: "",
      writtenDots: "",
    }));
    this.origin = layout.origin;
    this.barStart = layout.barStart;
    this.barSize = layout.barSize;

    const frame = this.frame(next);
    const smooth = !this.config.reduced && !firstLayout;
    next.forEach((item, i) => {
      const old = before.get(item.key);
      if (!old) {
        if (smooth) item.appear.x = 0;
        return;
      }
      if (old.el === item.el) {
        item.written = old.written;
        item.writtenDots = old.writtenDots;
      }
      item.shift = old.shift;
      if (!smooth) return;
      const drawnCentre = previousOrigin + old.start + old.size / 2 + old.shift;
      item.off.x = drawnCentre - (layout.origin + item.start + item.size / 2) - (frame.shift[i] ?? 0);
    });

    const first = next[0];
    const last = next[next.length - 1];
    if (smooth && first && last) {
      this.barOff.start.x = this.barDrawn.start - (layout.origin + layout.barStart + (frame.rowStart - first.start));
      this.barOff.end.x = this.barDrawn.end - (layout.origin + layout.barStart + layout.barSize + (frame.rowEnd - (last.start + last.size)));
    } else {
      rest(this.barOff.start, 0);
      rest(this.barOff.end, 0);
    }
    this.barOff.start.v = 0;
    this.barOff.end.v = 0;
    this.items = next;
    this.kick();
  }

  /** Starts carrying an item; `grab` is how far into the item the pointer took hold. */
  beginDrag(key: string, grab: number, pointer: number): void {
    this.drag = { key, grab, pointer };
    this.kick();
  }

  moveDrag(pointer: number): void {
    if (!this.drag) return;
    this.drag.pointer = pointer;
    this.kick();
  }

  /** Where the other items slide to while the carried one hovers over a slot (offsets from their rest place). */
  setSlide(targets: ReadonlyMap<string, number>): void {
    for (const item of this.items) item.slideTarget = targets.get(item.key) ?? 0;
    this.kick();
  }

  /** Puts the carried item down where it is; the next layout, or the springs, settle it into its slot. */
  endDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    const item = this.items.find((i) => i.key === drag.key);
    if (item) item.off.x = item.shift;
    this.drag = null;
    this.kick();
  }

  clearSlide(): void {
    for (const item of this.items) item.slideTarget = 0;
    this.kick();
  }

  private kick(): void {
    if (this.raf !== 0) return;
    this.last = 0;
    this.raf = requestAnimationFrame((now) => this.tick(now));
  }

  private frame(items: readonly ItemState[]): MagnifyFrame {
    const rests: RestItem[] = items.map((i) => ({ start: i.start, size: i.size, magnifies: i.magnifies }));
    const { peak, reach, gap } = this.config;
    // With no pointer the pivot sits far outside the row, where nothing is near it.
    const pivot = this.pointer === null || this.drag !== null ? -1e6 : this.pointer - this.origin;
    return computeMagnify(rests, pivot, { peak, radius: reach, engage: this.engage.x }, gap);
  }

  private tick(now: number): void {
    this.raf = 0;
    const dt = this.last === 0 ? FIRST_STEP_S : Math.min((now - this.last) / 1000, MAX_STEP_S);
    this.last = now;
    const { reduced, peak } = this.config;
    const dragging = this.drag !== null;

    const engageTarget = this.pointer !== null && peak > 1 && !dragging && !reduced ? 1 : 0;
    if (reduced) rest(this.engage, 0);
    else stepCritical(this.engage, engageTarget, OMEGA.engage, dt);
    this.engage.x = Math.min(1, Math.max(0, this.engage.x));
    let moving = !isSettled(this.engage, engageTarget, EPSILON / 10);

    const frame = this.frame(this.items);
    this.items.forEach((item, i) => {
      if (reduced) {
        rest(item.off, item.slideTarget);
        rest(item.appear, 1);
      } else {
        stepCritical(item.off, item.slideTarget, OMEGA.slide, dt);
        stepCritical(item.appear, 1, OMEGA.appear, dt);
      }
      if (!isSettled(item.off, item.slideTarget, EPSILON) || !isSettled(item.appear, 1, EPSILON / 10)) moving = true;

      let shift = (frame.shift[i] ?? 0) + item.off.x;
      let scale = frame.scale[i] ?? 1;
      if (this.drag?.key === item.key) {
        shift = this.drag.pointer - this.origin - this.drag.grab + item.size / 2 - (item.start + item.size / 2);
        scale = DRAG_SCALE;
        moving = true;
      }
      item.shift = shift;
      this.writeItem(item, shift, scale);
    });

    if (reduced) {
      rest(this.barOff.start, 0);
      rest(this.barOff.end, 0);
    } else {
      stepCritical(this.barOff.start, 0, OMEGA.slide, dt);
      stepCritical(this.barOff.end, 0, OMEGA.slide, dt);
    }
    if (!isSettled(this.barOff.start, 0, EPSILON) || !isSettled(this.barOff.end, 0, EPSILON)) moving = true;
    this.writeBar(frame);

    const hovered = this.pointer === null || dragging ? null : (this.items[frame.hovered]?.key ?? null);
    if (hovered !== this.hoveredKey) {
      this.hoveredKey = hovered;
      this.onHover(hovered);
    }
    this.writeLabel(frame);

    if (moving) this.kick();
  }

  private writeItem(item: ItemState, shift: number, scale: number): void {
    const grow = APPEAR_FROM + (1 - APPEAR_FROM) * Math.min(1, Math.max(0, item.appear.x));
    const s = scale * grow;
    const move = isVertical(this.config.edge) ? `translate3d(0,${px(shift)}px,0)` : `translate3d(${px(shift)}px,0,0)`;
    const text = Math.abs(s - 1) < SCALE_STEP ? move : `${move} scale(${s.toFixed(4)})`;
    if (text !== item.written) {
      item.written = text;
      item.el.style.transform = text;
    }
    const opacity = item.appear.x >= 1 ? "" : String(Math.min(1, Math.max(0, item.appear.x)));
    if (item.el.style.opacity !== opacity) item.el.style.opacity = opacity;
    if (item.dots) {
      if (move !== item.writtenDots) {
        item.writtenDots = move;
        item.dots.style.transform = move;
      }
      if (item.dots.style.opacity !== opacity) item.dots.style.opacity = opacity;
    }
  }

  /** The bar grows with the row: a stretch along the axis, with the corners and hairline kept round in CSS. */
  private writeBar(frame: MagnifyFrame): void {
    const first = this.items[0];
    const last = this.items[this.items.length - 1];
    if (!this.bar || !first || !last || this.barSize <= 0) return;
    const start = this.barStart + (frame.rowStart - first.start) + this.barOff.start.x;
    const end = this.barStart + this.barSize + (frame.rowEnd - (last.start + last.size)) + this.barOff.end.x;
    this.barDrawn = { start: this.origin + start, end: this.origin + end };
    const stretch = Math.max(1, end - start) / this.barSize;
    const move = px(start - this.barStart);
    const text = isVertical(this.config.edge)
      ? `translate3d(0,${move}px,0) scaleY(${stretch.toFixed(4)})`
      : `translate3d(${move}px,0,0) scaleX(${stretch.toFixed(4)})`;
    if (text === this.barWritten) return;
    this.barWritten = text;
    this.bar.style.transform = text;
    this.bar.style.setProperty("--stretch", stretch.toFixed(4));
  }

  /** The name label rides on the hovered item: its drawn centre, and above its magnified top. */
  private writeLabel(frame: MagnifyFrame): void {
    const label = this.label;
    const index = this.items.findIndex((i) => i.key === this.hoveredKey);
    const item = this.items[index];
    if (!label || !item) return;
    const centre = item.start + item.size / 2 + item.shift;
    const lift = ((frame.scale[index] ?? 1) - 1) * item.size * insideSign(this.config.edge);
    const text = isVertical(this.config.edge)
      ? `translate3d(${px(lift)}px,${px(centre)}px,0) translateY(-50%)`
      : `translate3d(${px(centre)}px,${px(lift)}px,0) translateX(-50%)`;
    if (text === this.labelWritten) return;
    this.labelWritten = text;
    label.style.transform = text;
  }
}
