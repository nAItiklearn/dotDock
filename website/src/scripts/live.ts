/**
 * Live widgets. Everything here reads this device only: the clock, the date, the calendar and,
 * where the browser exposes it, the battery. Nothing is sent anywhere. The sample widgets (RAM,
 * disk, weather) are static markup and are labelled as samples on the page.
 *
 * The clock, date, calendar and battery visuals follow apps/desktop/src/widgets, rebuilt for the
 * web with the same dot-matrix geometry.
 */
import { buildMatrix, type MatrixStyle } from "../lib/matrixGeometry";
import { everySecond, pad2 } from "../lib/dom";

const DAYS_PER_WEEK = 7;
const RING_R = 44;
const RING_LEN = 2 * Math.PI * RING_R;

// ---------- dot-matrix text into an existing <svg> ----------

function setMatrix(svg: SVGSVGElement, text: string, style: MatrixStyle, label?: string): void {
  const g = buildMatrix(text, style);
  svg.setAttribute("viewBox", `0 0 ${g.cols} ${g.rows}`);
  svg.querySelector("path")?.setAttribute("d", g.litPath);
  svg.setAttribute("aria-label", label ?? text);
}

function el<T extends Element>(root: ParentNode, selector: string): T | null {
  return root.querySelector<T>(selector);
}

// ---------- clocks ----------

interface ClockPrefs {
  style: MatrixStyle;
  hour24: boolean;
}
const clockPrefs: ClockPrefs = { style: "blocks", hour24: true };

function timeText(d: Date, hour24: boolean): string {
  const h = d.getHours();
  return `${pad2(hour24 ? h : h % 12 || 12)}:${pad2(d.getMinutes())}`;
}

const stageClock = el<SVGSVGElement>(document, "svg[data-live-clock-svg]:not([data-live-clock-svg='blocks'])");
const fixedClocks = [...document.querySelectorAll<SVGSVGElement>("svg[data-live-clock-svg='blocks']")];
const weekdayLabel = el<HTMLElement>(document, "[data-live-weekday]");

function renderClocks(now: Date): void {
  const label = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: !clockPrefs.hour24 });
  if (stageClock) {
    const clockWidget = stageClock.closest<HTMLElement>(".w--clock");
    clockWidget?.setAttribute("data-style", clockPrefs.style);
    setMatrix(stageClock, timeText(now, clockPrefs.hour24), clockPrefs.style, label);
  }
  const fixed = timeText(now, true);
  for (const svg of fixedClocks) setMatrix(svg, fixed, "blocks", fixed);
  if (weekdayLabel) weekdayLabel.textContent = now.toLocaleDateString(undefined, { weekday: "long" });
}

// ---------- date circle ----------

function renderDate(now: Date): void {
  const root = el<HTMLElement>(document, "[data-date]");
  if (!root) return;
  const day = pad2(now.getDate());
  const daySvg = el<SVGSVGElement>(root, "[data-date-day]");
  if (daySvg) setMatrix(daySvg, day, "blocks", day);
  const month = el<HTMLElement>(root, "[data-date-month]");
  const weekday = el<HTMLElement>(root, "[data-date-weekday]");
  if (month) month.textContent = now.toLocaleDateString(undefined, { month: "short" });
  if (weekday) weekday.textContent = now.toLocaleDateString(undefined, { weekday: "long" });
  root.setAttribute("aria-label", now.toLocaleDateString(undefined, { dateStyle: "full" }));
}

// ---------- calendar ----------

/** First day of the week for the visitor's locale: 0 = Sunday ... 6 = Saturday. */
function localeWeekStart(): number {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    // Intl numbers days 1 = Monday ... 7 = Sunday.
    if (info) return info.firstDay % DAYS_PER_WEEK;
  } catch {
    // Unknown locale tag: fall through to Monday.
  }
  return 1;
}

let renderedMonth = "";

function renderCalendar(now: Date): void {
  const root = el<HTMLElement>(document, "[data-calendar]");
  const grid = root ? el<HTMLElement>(root, "[data-cal-grid]") : null;
  if (!root || !grid) return;
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const key = `${year}-${month}-${today}`;
  if (key === renderedMonth) return;
  renderedMonth = key;

  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() - localeWeekStart() + DAYS_PER_WEEK) % DAYS_PER_WEEK;

  const cells: HTMLElement[] = [];
  for (let i = 0; i < lead; i++) {
    const pad = document.createElement("span");
    pad.setAttribute("aria-hidden", "true");
    cells.push(pad);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const cell = document.createElement("span");
    cell.setAttribute("role", "gridcell");
    cell.className = day === today ? "w-cal__day w-cal__day--today tabular" : "w-cal__day tabular";
    if (day === today) cell.setAttribute("aria-current", "date");
    cell.textContent = String(day);
    cells.push(cell);
  }
  grid.replaceChildren(...cells);

  const todayEl = el<HTMLElement>(root, "[data-cal-today]");
  const monthEl = el<HTMLElement>(root, "[data-cal-month]");
  if (todayEl) todayEl.textContent = String(today);
  if (monthEl) monthEl.textContent = first.toLocaleDateString(undefined, { month: "long" });
  root.setAttribute("aria-label", now.toLocaleDateString(undefined, { month: "long", year: "numeric" }));
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
  const ring = el<HTMLElement>(document, "[data-battery-ring]");
  ring?.classList.add("is-unavailable");
  const caption = el<HTMLElement>(document, "[data-battery-caption]");
  if (caption) caption.textContent = "Not shared";
  const pct = el<SVGSVGElement>(document, "[data-battery-pct]");
  if (pct) setMatrix(pct, "--", "blocks", "Battery level unavailable");
  const pillPct = el<HTMLElement>(document, "[data-pill-pct]");
  const pillState = el<HTMLElement>(document, "[data-pill-state]");
  if (pillPct) pillPct.textContent = "--";
  if (pillState) pillState.textContent = "This browser does not share battery data";
}

function renderBattery(b: BatteryManager): void {
  const percent = Math.round(b.level * 100);
  const ring = el<HTMLElement>(document, "[data-battery-ring]");
  const value = el<SVGCircleElement>(document, "[data-ring-value]");
  const pct = el<SVGSVGElement>(document, "[data-battery-pct]");
  const bolt = el<HTMLElement>(document, "[data-bolt]");
  const caption = el<HTMLElement>(document, "[data-battery-caption]");
  const pillPct = el<HTMLElement>(document, "[data-pill-pct]");
  const pillState = el<HTMLElement>(document, "[data-pill-state]");
  const full = b.charging && percent >= 100;

  value?.setAttribute("stroke-dashoffset", String(RING_LEN * (1 - b.level)));
  if (pct) setMatrix(pct, String(percent), "blocks", `${percent} percent`);
  bolt?.classList.toggle("bolt--on", b.charging);
  if (caption) caption.textContent = b.charging ? "Charging" : "Battery";
  ring?.setAttribute("aria-label", `Battery ${percent} percent${b.charging ? ", charging" : ""}`);

  const left = b.charging ? null : formatHoursMinutes(b.dischargingTime);
  if (pillPct) pillPct.textContent = `${percent}%`;
  if (pillState) pillState.textContent = full ? "Full" : b.charging ? "Charging" : left ? `${left} left` : "On battery";
}

async function initBattery(): Promise<void> {
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

// ---------- clock controls ----------

function initClockControls(): void {
  const group = el<HTMLElement>(document, "[data-clock-style-group]");
  const hours = el<HTMLButtonElement>(document, "[data-clock-24h]");
  const styleButtons = group ? [...group.querySelectorAll<HTMLButtonElement>("[data-clock-style]")] : [];

  const setStyle = (style: MatrixStyle): void => {
    clockPrefs.style = style;
    for (const b of styleButtons) {
      const on = b.dataset["clockStyle"] === style;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    renderClocks(new Date());
  };

  for (const b of styleButtons) {
    b.addEventListener("click", () => setStyle(b.dataset["clockStyle"] as MatrixStyle));
  }
  group?.addEventListener("keydown", (e) => {
    const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
    const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
    if (!forward && !back) return;
    const at = styleButtons.findIndex((b) => b === document.activeElement);
    if (at < 0) return;
    e.preventDefault();
    const next = styleButtons[(at + (forward ? 1 : styleButtons.length - 1)) % styleButtons.length];
    next?.focus();
    next?.click();
  });
  hours?.addEventListener("click", () => {
    clockPrefs.hour24 = !clockPrefs.hour24;
    hours.setAttribute("aria-checked", String(clockPrefs.hour24));
    renderClocks(new Date());
  });
}

// ---------- start ----------

initClockControls();
void initBattery();

let lastMinute = -1;
everySecond((now) => {
  const minute = now.getHours() * 60 + now.getMinutes();
  if (minute === lastMinute) return;
  lastMinute = minute;
  renderClocks(now);
  renderDate(now);
  renderCalendar(now);
});
