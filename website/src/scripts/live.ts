/**
 * Live widgets. Everything here reads this device only: the clock, the date, a
 * working timer and, where the browser exposes it, the battery. Nothing is sent anywhere. The
 * sample widgets (RAM, disk, music) are static markup and are labelled as samples.
 *
 * The visuals follow apps/desktop/src/widgets, rebuilt for the web with the same dot-matrix
 * geometry. Every widget can appear several times on the page, so each update loops over all of them.
 */
import { buildMatrix, type MatrixStyle } from "../lib/matrixGeometry";
import { everySecond, pad2 } from "../lib/dom";
import { TIMER_SECONDS, minutesLit } from "../lib/timer";

const RING_R = 44;
const RING_LEN = 2 * Math.PI * RING_R;

const all = <T extends Element>(selector: string, root: ParentNode = document): T[] => [
  ...root.querySelectorAll<T>(selector),
];
const one = <T extends Element>(root: ParentNode, selector: string): T | null => root.querySelector<T>(selector);

// ---------- dot-matrix text into an existing <svg> ----------

function setMatrix(svg: SVGSVGElement, text: string, style: MatrixStyle, label?: string): void {
  const g = buildMatrix(text, style);
  svg.setAttribute("viewBox", `0 0 ${g.cols} ${g.rows}`);
  svg.querySelector("path")?.setAttribute("d", g.litPath);
  svg.setAttribute("aria-label", label ?? text);
}

function isStyle(value: string | undefined): value is MatrixStyle {
  return value === "dots" || value === "blocks" || value === "stripes";
}

// ---------- clocks ----------

function renderClocks(now: Date): void {
  const label = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  const text = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  for (const svg of all<SVGSVGElement>("svg[data-live-clock-svg]")) {
    const style = svg.dataset["liveClockSvg"];
    setMatrix(svg, text, isStyle(style) ? style : "blocks", label);
  }
  const weekday = now.toLocaleDateString(undefined, { weekday: "long" });
  for (const el of all<HTMLElement>("[data-live-weekday]")) el.textContent = weekday;
}

// ---------- date circle ----------

function renderDate(now: Date): void {
  const day = pad2(now.getDate());
  for (const root of all<HTMLElement>("[data-date]")) {
    const daySvg = one<SVGSVGElement>(root, "[data-date-day]");
    if (daySvg) setMatrix(daySvg, day, "blocks", day);
    const month = one<HTMLElement>(root, "[data-date-month]");
    const weekday = one<HTMLElement>(root, "[data-date-weekday]");
    if (month) month.textContent = now.toLocaleDateString(undefined, { month: "short" });
    if (weekday) weekday.textContent = now.toLocaleDateString(undefined, { weekday: "long" });
    root.setAttribute("aria-label", now.toLocaleDateString(undefined, { dateStyle: "full" }));
  }
}

// ---------- battery (Battery Status API, Chromium only) ----------

interface BatteryManager extends EventTarget {
  readonly level: number;
  readonly charging: boolean;
  readonly dischargingTime: number;
}
type BatteryNavigator = Navigator & { getBattery?: () => Promise<BatteryManager> };

function formatHoursMinutes(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds / 60);
  return `${Math.floor(total / 60)}:${pad2(total % 60)}`;
}

function showBatteryUnavailable(): void {
  for (const ring of all<HTMLElement>("[data-battery-ring]")) {
    ring.classList.add("is-unavailable");
    const caption = one<HTMLElement>(ring, "[data-battery-caption]");
    if (caption) caption.textContent = "Not shared";
    const pct = one<SVGSVGElement>(ring, "[data-battery-pct]");
    if (pct) setMatrix(pct, "--", "blocks", "Battery level unavailable");
  }
  for (const pill of all<HTMLElement>("[data-battery-pill]")) {
    const pct = one<HTMLElement>(pill, "[data-pill-pct]");
    const state = one<HTMLElement>(pill, "[data-pill-state]");
    if (pct) pct.textContent = "--";
    if (state) state.textContent = "This browser does not share battery data";
  }
}

function renderBattery(b: BatteryManager): void {
  const percent = Math.round(b.level * 100);
  const full = b.charging && percent >= 100;
  for (const ring of all<HTMLElement>("[data-battery-ring]")) {
    one<SVGCircleElement>(ring, "[data-ring-value]")?.setAttribute("stroke-dashoffset", String(RING_LEN * (1 - b.level)));
    const pct = one<SVGSVGElement>(ring, "[data-battery-pct]");
    if (pct) setMatrix(pct, String(percent), "blocks", `${percent} percent`);
    one<HTMLElement>(ring, "[data-bolt]")?.classList.toggle("bolt--on", b.charging);
    const caption = one<HTMLElement>(ring, "[data-battery-caption]");
    if (caption) caption.textContent = b.charging ? "Charging" : "Battery";
    ring.setAttribute("aria-label", `Battery ${percent} percent${b.charging ? ", charging" : ""}`);
  }
  const left = b.charging ? null : formatHoursMinutes(b.dischargingTime);
  for (const pill of all<HTMLElement>("[data-battery-pill]")) {
    const pct = one<HTMLElement>(pill, "[data-pill-pct]");
    const state = one<HTMLElement>(pill, "[data-pill-state]");
    if (pct) pct.textContent = `${percent}%`;
    if (state) state.textContent = full ? "Full" : b.charging ? "Charging" : left ? `${left} left` : "On battery";
  }
}

async function initBattery(): Promise<void> {
  if (all("[data-battery-ring], [data-battery-pill]").length === 0) return;
  const nav = navigator as BatteryNavigator;
  if (!nav.getBattery) {
    showBatteryUnavailable();
    return;
  }
  try {
    const battery = await nav.getBattery();
    const update = (): void => renderBattery(battery);
    for (const type of ["levelchange", "chargingchange", "dischargingtimechange"]) battery.addEventListener(type, update);
    update();
  } catch {
    showBatteryUnavailable();
  }
}

// ---------- timer: a working countdown, started and paused by the visitor ----------

function initTimers(): void {
  for (const root of all<HTMLElement>("[data-timer]")) {
    const display = one<HTMLElement>(root, "[data-timer-display]");
    const toggle = one<HTMLButtonElement>(root, "[data-timer-toggle]");
    const reset = one<HTMLButtonElement>(root, "[data-timer-reset]");
    const body = one<HTMLElement>(root, ".w-timer");
    const minutes = [...root.querySelectorAll<SVGCircleElement>("[data-timer-dots] circle")];
    if (!display || !toggle || !reset || !body) continue;

    let remaining = TIMER_SECONDS;
    let endsAt = 0;
    let handle = 0;

    const show = (): void => {
      display.textContent = `${pad2(Math.floor(remaining / 60))}:${pad2(remaining % 60)}`;
      const lit = minutesLit(remaining);
      minutes.forEach((dot, i) => dot.classList.toggle("is-off", i >= lit));
    };
    const stop = (): void => {
      window.clearInterval(handle);
      handle = 0;
      body.classList.remove("is-running");
      toggle.setAttribute("aria-label", "Start the timer");
    };
    const tick = (): void => {
      remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      show();
      if (remaining === 0) {
        stop();
        remaining = TIMER_SECONDS;
        show();
      }
    };
    toggle.addEventListener("click", () => {
      if (handle) {
        remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
        stop();
        show();
        return;
      }
      endsAt = Date.now() + remaining * 1000;
      handle = window.setInterval(tick, 250);
      body.classList.add("is-running");
      toggle.setAttribute("aria-label", "Pause the timer");
    });
    reset.addEventListener("click", () => {
      stop();
      remaining = TIMER_SECONDS;
      show();
    });
    show();
  }
}

// ---------- start ----------

initTimers();
void initBattery();

let lastMinute = -1;
everySecond((now) => {
  const minute = now.getHours() * 60 + now.getMinutes();
  if (minute === lastMinute) return;
  lastMinute = minute;
  renderClocks(now);
  renderDate(now);
});
