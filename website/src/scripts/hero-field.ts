/**
 * Hero: a full-bleed lattice of dots with the live time drawn in it, using the product's 5x7
 * dot-matrix glyphs. One lattice, one cell size: lit cells are large dots, the rest are small
 * dim ones, like an LED panel.
 *
 * Rendering is on demand. A frame loop runs only while something moves (intro, a digit changing,
 * the pointer lens, a click ripple); otherwise the canvas sits still and costs nothing.
 *
 * Real data only: the time, the seconds track and the date caption all come from `new Date()`.
 */
import { buildCells } from "../lib/matrixGeometry";
import { onThemeChange, pad2, prefersReducedMotion, requireEl } from "../lib/dom";

const CLOCK_COLS = 25;
const CLOCK_ROWS = 7;
const COLON_COL = 12;
/** Row of the seconds track: one blank row below the glyphs. */
const TRACK_ROW = CLOCK_ROWS + 1;
const TAU = Math.PI * 2;

const ON_RADIUS = 0.4; // in cells, same proportion as the product's DotMatrix
const OFF_RADIUS = 0.05;
const TRACK_RADIUS = 0.17;
const LENS_RADIUS_CELLS = 4.2;
const LENS_GROW = 0.2;
const LENS_PUSH = 0.2;
const INTRO_SPREAD_MS = 650;
const INTRO_FADE_MS = 300;
const INTRO_TOTAL_MS = INTRO_SPREAD_MS + INTRO_FADE_MS + 60;
const RIPPLE_LIFE_S = 1.6;
const SETTLE_RATE = 18; // per second, exponential approach of a cell to its target

interface Palette {
  readonly on: string;
  readonly off: string;
  readonly accent: string;
  readonly ink: string;
}

interface Ripple {
  readonly x: number;
  readonly y: number;
  readonly t0: number;
}

const reduced = prefersReducedMotion();

function start(): void {
  const hero = requireEl<HTMLElement>(document, "[data-hero]");
  const canvas = requireEl<HTMLCanvasElement>(hero, "[data-hero-canvas]");
  const slot = requireEl<HTMLElement>(hero, "[data-clock-slot]");
  const caption = requireEl<HTMLElement>(hero, "[data-clock-caption]");
  const srTime = requireEl<HTMLTimeElement>(hero, "[data-clock-sr]");
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return;
  const c: CanvasRenderingContext2D = context;

  // ---- lattice state ----
  let width = 0;
  let height = 0;
  let dpr = 1;
  let cell = 40;
  let ox = 0;
  let oy = 0;
  let cols = 0;
  let rows = 0;
  let clockI0 = 0;
  let clockJ0 = 0;
  let level = new Float32Array(0); // current lit amount 0..1
  let target = new Uint8Array(0); // desired lit state
  let pendingAt = new Float64Array(0); // performance.now() when a new target takes effect, 0 = none
  let appear = new Float32Array(0); // intro delay per cell in ms

  let palette: Palette = readPalette();
  let timeText = "";
  let colonOn = true;
  let trackLit = 0;

  // ---- interaction state ----
  let pointerX = 0;
  let pointerY = 0;
  let lensX = 0;
  let lensY = 0;
  let lensStrength = 0;
  let lensWanted = 0;
  const ripples: Ripple[] = [];

  // ---- loop state ----
  let introStart = reduced ? -Infinity : performance.now();
  let raf = 0;
  let last = 0;
  let visible = true;

  function readPalette(): Palette {
    const s = getComputedStyle(hero);
    const v = (name: string): string => s.getPropertyValue(name).trim();
    return { on: v("--dot-on"), off: v("--dot-off"), accent: v("--accent"), ink: v("--text") };
  }

  const index = (i: number, j: number): number => j * cols + i;

  function layout(): void {
    const heroRect = hero.getBoundingClientRect();
    const slotRect = slot.getBoundingClientRect();
    width = Math.max(1, Math.round(heroRect.width));
    height = Math.max(1, Math.round(heroRect.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    cell = Math.max(6, slotRect.width / CLOCK_COLS);
    const slotX = slotRect.left - heroRect.left;
    const slotY = slotRect.top - heroRect.top;
    const mod = (a: number, n: number): number => ((a % n) + n) % n;
    ox = mod(slotX, cell) - cell;
    oy = mod(slotY, cell) - cell;
    cols = Math.ceil((width - ox) / cell) + 1;
    rows = Math.ceil((height - oy) / cell) + 1;
    clockI0 = Math.round((slotX - ox) / cell);
    clockJ0 = Math.round((slotY - oy) / cell);

    level = new Float32Array(cols * rows);
    target = new Uint8Array(cols * rows);
    pendingAt = new Float64Array(cols * rows);
    appear = new Float32Array(cols * rows);

    // Intro order: a sweep that starts at the colon and travels outwards.
    const cx = clockI0 + COLON_COL;
    const cy = clockJ0 + CLOCK_ROWS / 2;
    let far = 0;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) far = Math.max(far, Math.hypot(i - cx, j - cy));
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) appear[index(i, j)] = (Math.hypot(i - cx, j - cy) / far) * INTRO_SPREAD_MS;
    }
    applyTargets(false);
  }

  /** Writes the clock and the seconds track into the target grid. */
  function applyTargets(animate: boolean): void {
    const now = performance.now();
    const glyphs = buildCells(timeText || "00:00", "fine");
    for (let r = 0; r < CLOCK_ROWS; r++) {
      for (let c = 0; c < CLOCK_COLS; c++) {
        let lit = glyphs.lit[r]?.[c] === true;
        if (lit && c === COLON_COL && !colonOn) lit = false;
        setTarget(clockI0 + c, clockJ0 + r, lit, animate ? now + c * 7 + r * 9 : 0, animate);
      }
    }
    for (let c = 0; c < CLOCK_COLS; c++) {
      setTarget(clockI0 + c, clockJ0 + TRACK_ROW, c < trackLit, animate ? now + c * 12 : 0, animate);
    }
  }

  function setTarget(i: number, j: number, lit: boolean, at: number, animate: boolean): void {
    if (i < 0 || j < 0 || i >= cols || j >= rows) return;
    const k = index(i, j);
    const next = lit ? 1 : 0;
    if (target[k] === next) return;
    target[k] = next;
    if (!animate || reduced) {
      level[k] = next;
      pendingAt[k] = 0;
    } else {
      pendingAt[k] = at;
    }
  }

  // ---- time ----
  const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" });
  const zoneFormat = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" });
  const srFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

  function tick(): void {
    const now = new Date();
    const text = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    const half = now.getMilliseconds() < 500;
    const lit = Math.floor((now.getSeconds() + now.getMilliseconds() / 1000) / (60 / CLOCK_COLS));
    const minuteChanged = text !== timeText;
    const changed = minuteChanged || (reduced ? false : half !== colonOn) || lit !== trackLit;
    if (minuteChanged) {
      const zone = zoneFormat.formatToParts(now).find((p) => p.type === "timeZoneName")?.value;
      caption.textContent = zone ? `${dateFormat.format(now)} · ${zone}` : dateFormat.format(now);
      srTime.textContent = srFormat.format(now);
      srTime.dateTime = `${text}`;
    }
    timeText = text;
    colonOn = reduced ? true : half;
    trackLit = lit;
    if (changed) {
      applyTargets(true);
      requestFrame();
    }
    // Wake on the next half-second boundary so the colon blinks in step with the real clock.
    const ms = now.getMilliseconds();
    window.setTimeout(tick, (ms < 500 ? 500 : 1000) - ms + 4);
  }

  // ---- drawing ----
  function circle(x: number, y: number, r: number): void {
    c.moveTo(x + r, y);
    c.arc(x, y, r, 0, TAU);
  }

  function frame(nowMs: number): void {
    raf = 0;
    if (!visible || document.hidden) return;
    const dt = Math.min(0.05, last ? (nowMs - last) / 1000 : 0.016);
    last = nowMs;

    const introElapsed = nowMs - introStart;
    const introActive = introElapsed < INTRO_TOTAL_MS;

    // Pointer lens eases toward the pointer; strength eases in and out.
    const ease = 1 - Math.exp(-dt * 14);
    lensX += (pointerX - lensX) * ease;
    lensY += (pointerY - lensY) * ease;
    lensStrength += (lensWanted - lensStrength) * (1 - Math.exp(-dt * 9));
    const lensR = Math.min(260, Math.max(90, cell * LENS_RADIUS_CELLS));
    const lensR2 = lensR * lensR;
    const lensOn = lensStrength > 0.004;

    for (let k = ripples.length - 1; k >= 0; k--) {
      const rp = ripples[k];
      if (rp && (nowMs - rp.t0) / 1000 > RIPPLE_LIFE_S) ripples.splice(k, 1);
    }
    const rippleSpeed = Math.max(520, cell * 14);
    const rippleWidth = cell * 1.6;

    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, width, height);

    const rOn = cell * ON_RADIUS;
    const rOff = Math.max(0.9, cell * OFF_RADIUS);
    const rTrack = cell * TRACK_RADIUS;
    let moving = introActive || lensOn || ripples.length > 0;

    // Pass 1: resting off-dots, batched into one path when nothing perturbs them.
    const batch = !introActive;
    if (batch) {
      c.fillStyle = palette.off;
      c.beginPath();
    }
    const glows: number[] = []; // x, y, radius, alpha, colour index (0 ink, 1 on, 2 accent)

    for (let j = 0; j < rows; j++) {
      const cy = oy + j * cell + cell / 2;
      for (let i = 0; i < cols; i++) {
        const k = index(i, j);
        const cx = ox + i * cell + cell / 2;

        // Settle toward the target.
        let lv = level[k];
        const tg = target[k];
        const due = pendingAt[k];
        if (due && nowMs >= due) pendingAt[k] = 0;
        if (!pendingAt[k] && lv !== tg) {
          lv += (tg - lv) * (1 - Math.exp(-dt * SETTLE_RATE));
          if (Math.abs(tg - lv) < 0.004) lv = tg;
          level[k] = lv;
          moving = true;
        } else if (pendingAt[k]) {
          moving = true;
        }

        const intro = reduced ? 1 : Math.min(1, Math.max(0, (introElapsed - appear[k]) / INTRO_FADE_MS));
        const isTrack = j === clockJ0 + TRACK_ROW && i >= clockI0 && i < clockI0 + CLOCK_COLS;

        // Influence of the lens and any ripples on this cell.
        let infl = 0;
        let px = cx;
        let py = cy;
        if (lensOn) {
          const dx = cx - lensX;
          const dy = cy - lensY;
          const d2 = dx * dx + dy * dy;
          if (d2 < lensR2) {
            const d = Math.sqrt(d2);
            const t = 1 - d / lensR;
            const f = t * t * (3 - 2 * t) * lensStrength;
            infl += f;
            if (d > 0.001) {
              px += (dx / d) * f * cell * LENS_PUSH;
              py += (dy / d) * f * cell * LENS_PUSH;
            }
          }
        }
        for (const rp of ripples) {
          const age = (nowMs - rp.t0) / 1000;
          const d = Math.hypot(cx - rp.x, cy - rp.y);
          const off = (d - age * rippleSpeed) / rippleWidth;
          if (Math.abs(off) < 3) infl += Math.exp(-off * off) * (1 - age / RIPPLE_LIFE_S) * 0.9;
        }

        const lit = lv * intro;
        const base = isTrack ? rTrack : rOn;

        if (lit > 0.02) {
          // Lit dot: radius grows from the off size to full size as it lights.
          const r = (rOff + (base - rOff) * lit) * (1 + Math.min(1, infl) * 0.14);
          glows.push(px, py, r, Math.min(1, lit * 1.5), isTrack ? 2 : 1);
        }
        if (lit < 0.98) {
          const restR = rOff * intro;
          if (infl < 0.01) {
            if (batch) circle(cx, cy, restR);
            else glows.push(cx, cy, restR, intro, 3);
          } else {
            const g = Math.min(1, infl);
            glows.push(px, py, rOff + g * cell * LENS_GROW, (0.22 + g * 0.7) * (1 - lit) * intro, 0);
          }
        }
      }
    }
    if (batch) c.fill();

    // Pass 2: everything that is lit or glowing, grouped by colour.
    const colours = [palette.ink, palette.on, palette.accent, palette.off];
    for (let col = 0; col < colours.length; col++) {
      c.fillStyle = colours[col] ?? palette.on;
      for (let n = 0; n < glows.length; n += 5) {
        if (glows[n + 4] !== col) continue;
        c.globalAlpha = glows[n + 3] ?? 1;
        c.beginPath();
        circle(glows[n] ?? 0, glows[n + 1] ?? 0, glows[n + 2] ?? 0);
        c.fill();
      }
    }
    c.globalAlpha = 1;

    if (moving) requestFrame();
  }

  function requestFrame(): void {
    if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame);
  }

  // ---- events ----
  function local(e: PointerEvent): { x: number; y: number } {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  if (!reduced) {
    hero.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      const p = local(e);
      pointerX = p.x;
      pointerY = p.y;
      if (lensWanted === 0) {
        lensX = p.x;
        lensY = p.y;
      }
      lensWanted = 1;
      requestFrame();
    });
    hero.addEventListener("pointerleave", () => {
      lensWanted = 0;
      requestFrame();
    });
    hero.addEventListener("pointerdown", (e) => {
      if ((e.target as Element).closest("a, button")) return;
      const p = local(e);
      ripples.push({ x: p.x, y: p.y, t0: performance.now() });
      if (ripples.length > 4) ripples.shift();
      requestFrame();
    });
  }

  const resizer = new ResizeObserver(() => {
    layout();
    requestFrame();
  });
  resizer.observe(hero);
  resizer.observe(slot);

  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible) requestFrame();
  }).observe(hero);
  document.addEventListener("visibilitychange", () => requestFrame());

  onThemeChange(() => {
    palette = readPalette();
    requestFrame();
  });

  // Fonts do not affect the lattice, but the first layout needs the slot's final box.
  layout();
  tick();
  requestFrame();
}

start();
