import { computeMagnify, type MagnifyFrame, type RestItem } from "./magnify";
import { advance, omegaForSettle, rest, type SpringState } from "./spring";

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
/** The bar's middle runs this far under each rounded end, so no seam shows between the pieces. */
export const PLATE_OVERLAP = 2;

const OMEGA = {
  engage: omegaForSettle(SETTLE_MS.engage),
  slide: omegaForSettle(SETTLE_MS.slide),
  appear: omegaForSettle(SETTLE_MS.appear),
};

export interface LayoutItem {
  readonly key: string;
  /** The item's face: scaled and moved by the engine. */
  readonly el: HTMLElement;
  /** Rest span along the axis, in dock-local px. */
  readonly start: number;
  readonly size: number;
  /** Share of the magnification the item takes (0: it only makes room). */
  readonly weight: number;
  /** The face is laid out this much larger than its slot and shown scaled down, so magnifying never upsamples it. */
  readonly render: number;
  /** The name shown on the label while the pointer is over the item, and the dim text beside it ("" for none). */
  readonly name: string;
  readonly sub: string;
}

export interface Layout {
  readonly items: readonly LayoutItem[];
  /** The bar's own rest span along the axis, in dock-local px. */
  readonly barStart: number;
  readonly barSize: number;
  /** Length of each rounded end of the bar along the axis: half its thickness. */
  readonly cap: number;
  /** Window coordinate of dock-local 0 along the axis. */
  readonly origin: number;
}

export interface EngineConfig {
  readonly peak: number;
  /** Distance from the pointer at which magnification fades out, in px. */
  readonly reach: number;
  readonly gap: number;
  /** Reduced motion: no magnification, and everything lands in place at once. */
  readonly reduced: boolean;
}

/** The label above the hovered item: its box and the two text nodes the engine fills in. */
export interface LabelParts {
  readonly root: HTMLElement;
  readonly name: HTMLElement;
  readonly sub: HTMLElement;
}

/** The three pieces the bar is drawn from. */
export interface PlateParts {
  readonly start: HTMLElement;
  readonly mid: HTMLElement;
  readonly end: HTMLElement;
}

interface ItemState extends LayoutItem {
  /** Spring offset from the rest place: edit-mode slides and rebases after the layout changed. */
  off: SpringState;
  appear: SpringState;
  slideTarget: number;
  /** Total translation last applied, in px along the axis. */
  shift: number;
  written: string;
}

interface DragState {
  readonly key: string;
  /** Distance from the item's start to where the pointer took hold. */
  readonly grab: number;
  /** Pointer along the axis, window px. */
  pointer: number;
}

const px = (n: number): string => String(Math.round(n * 100) / 100);
/** Translations land on whole device pixels, so a face is never resampled between two of them: no smear at rest or in motion. */
const snap = (n: number): number => {
  const scale = window.devicePixelRatio || 1;
  return Math.round(n * scale) / scale;
};

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
  private plate: PlateParts | null = null;
  private cap = 0;
  private barOff: { start: SpringState; end: SpringState } = { start: { x: 0, v: 0 }, end: { x: 0, v: 0 } };
  /** Window coordinates of the bar's two ends as last drawn. */
  private barDrawn = { start: 0, end: 0 };
  private plateWritten = { start: "", mid: "", end: "" };
  private frozen = false;
  private label: LabelParts | null = null;
  private labelBlocked = false;
  private previewKey: string | null = null;
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
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  /** A page nobody can see draws nothing: frames stop while the document is hidden and resume when it shows. */
  private readonly onVisibility = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else this.kick();
  };

  configure(config: EngineConfig): void {
    this.config = config;
    this.kick();
  }

  attachPlate(parts: PlateParts | null): void {
    this.plate = parts;
    this.plateWritten = { start: "", mid: "", end: "" };
  }

  /** The core froze the dock: no frames until it thaws. */
  setFrozen(frozen: boolean): void {
    if (frozen === this.frozen) return;
    this.frozen = frozen;
    if (frozen) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else this.kick();
  }

  attachLabel(parts: LabelParts | null): void {
    this.label = parts;
    this.labelWritten = "";
  }

  /** Hides the label while something else (a menu, a popover, edit mode) has the pointer's attention. */
  setLabelBlocked(blocked: boolean): void {
    this.labelBlocked = blocked;
    this.kick();
  }

  /** The item whose window preview is open shows its title there instead of on the label. */
  setPreviewKey(key: string | null): void {
    this.previewKey = key;
    this.kick();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    document.removeEventListener("visibilitychange", this.onVisibility);
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
    }));
    this.origin = layout.origin;
    this.barStart = layout.barStart;
    this.barSize = layout.barSize;
    this.cap = layout.cap;

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
    if (this.raf !== 0 || this.frozen || document.hidden) return;
    this.last = 0;
    this.raf = requestAnimationFrame((now) => this.tick(now));
  }

  private frame(items: readonly ItemState[]): MagnifyFrame {
    const rests: RestItem[] = items.map((i) => ({ start: i.start, size: i.size, weight: i.weight }));
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
    let moving = false;
    if (reduced) rest(this.engage, 0);
    else moving = advance(this.engage, engageTarget, OMEGA.engage, dt, EPSILON / 10);
    this.engage.x = Math.min(1, Math.max(0, this.engage.x));

    const frame = this.frame(this.items);
    this.items.forEach((item, i) => {
      if (reduced) {
        rest(item.off, item.slideTarget);
        rest(item.appear, 1);
      } else {
        const sliding = advance(item.off, item.slideTarget, OMEGA.slide, dt, EPSILON);
        const arriving = advance(item.appear, 1, OMEGA.appear, dt, EPSILON / 10);
        if (sliding || arriving) moving = true;
      }

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
      const startMoving = advance(this.barOff.start, 0, OMEGA.slide, dt, EPSILON);
      const endMoving = advance(this.barOff.end, 0, OMEGA.slide, dt, EPSILON);
      if (startMoving || endMoving) moving = true;
    }
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
    // The face is drawn `render` times larger than its slot, so the scale shown is relative to that.
    const s = (scale * grow) / item.render;
    const move = `translate3d(${px(snap(shift))}px,0,0)`;
    const text = Math.abs(s - 1) < SCALE_STEP ? move : `${move} scale(${s.toFixed(4)})`;
    if (text !== item.written) {
      item.written = text;
      item.el.style.transform = text;
    }
    const opacity = item.appear.x >= 1 ? "" : String(Math.min(1, Math.max(0, item.appear.x)));
    if (item.el.style.opacity !== opacity) item.el.style.opacity = opacity;
  }

  /** The bar grows with the row: a stretch along the axis, with the corners and hairline kept round in CSS. */
  private writeBar(frame: MagnifyFrame): void {
    const first = this.items[0];
    const last = this.items[this.items.length - 1];
    const parts = this.plate;
    if (!parts || !first || !last || this.barSize <= 0) return;
    const startDelta = frame.rowStart - first.start + this.barOff.start.x;
    const endDelta = frame.rowEnd - (last.start + last.size) + this.barOff.end.x;
    this.barDrawn = { start: this.origin + this.barStart + startDelta, end: this.origin + this.barStart + this.barSize + endDelta };

    // Three pieces, all moved by transforms: the rounded ends keep their shape and the middle stretches between them.
    const mid0 = Math.max(this.barSize - 2 * this.cap + 2 * PLATE_OVERLAP, 1);
    const drawn = this.barSize + endDelta - startDelta;
    const stretch = Math.max(drawn - 2 * this.cap + 2 * PLATE_OVERLAP, 1) / mid0;
    const move = (d: number): string => `translate3d(${px(snap(d))}px,0,0)`;
    const next = {
      start: move(startDelta),
      mid: `${move(startDelta)} scaleX(${stretch.toFixed(4)})`,
      end: move(endDelta),
    };
    for (const part of ["start", "mid", "end"] as const) {
      if (next[part] === this.plateWritten[part]) continue;
      this.plateWritten[part] = next[part];
      parts[part].style.transform = next[part];
    }
  }

  /**
   * The name label rides on the hovered item: its drawn centre, and above its magnified top. The engine writes its
   * text too, so moving the pointer along the dock never goes through React.
   */
  private writeLabel(frame: MagnifyFrame): void {
    const label = this.label;
    if (!label) return;
    const index = this.items.findIndex((i) => i.key === this.hoveredKey);
    const item = this.items[index];
    const shown = item !== undefined && !this.labelBlocked && this.previewKey !== item.key && item.name !== "";
    if (label.root.dataset.visible !== (shown ? "true" : undefined)) {
      if (shown) label.root.dataset.visible = "true";
      else delete label.root.dataset.visible;
    }
    if (!shown || !item) return;
    if (label.name.textContent !== item.name) label.name.textContent = item.name;
    if (label.sub.textContent !== item.sub) label.sub.textContent = item.sub;
    const centre = item.start + item.size / 2 + item.shift;
    // Magnified items grow up, away from the screen's bottom edge, so the label rises with them.
    const lift = -((frame.scale[index] ?? 1) - 1) * item.size;
    const text = `translate3d(${px(snap(centre))}px,${px(snap(lift))}px,0) translateX(-50%)`;
    if (text === this.labelWritten) return;
    this.labelWritten = text;
    label.root.style.transform = text;
  }
}
