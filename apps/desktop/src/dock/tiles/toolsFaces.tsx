import { useEffect, useMemo } from "react";
import { Icon, type IconName } from "../../design-system/Icon";
import { useProvider } from "../../providers/store";
import { orderedNotes } from "../../widgets/notesModel";
import { useNotesStore } from "../../widgets/notesStore";
import { plural, t } from "../strings";
import { runTileCommand, tilesBackend } from "./backend";
import { inkFor } from "./colour";
import { DotRing } from "./DotRing";
import { emojiOf } from "./emoji";
import { useFeed } from "./feeds";
import { readFeed, type FeedRead } from "./hub";
import { useMinuteClock } from "./hooks";
import { formatRate } from "./network";
import { useNetworkHistory } from "./networkHistory";
import { Mark, TileShell, Words, issueText, type TileControls } from "./shell";
import { useTools } from "./toolsStore";
import type { ToggleName, TogglesView } from "./ui-types";
import { convert, formatNumber, parseAmount, unitSymbol, type UnitCategory } from "./units";
import { worldRows } from "./world";
import "./faces.css";

const PERCENT = 100;
const LOW_BATTERY = 20;

interface FaceProps {
  readonly controls: TileControls;
}

const noData = (read: FeedRead<unknown>): string => (read.state === "issue" ? issueText(read.issue) : "");

// Processor and battery --------------------------------------------------------------------------------------------

export function CpuFace() {
  const { data } = useProvider("system");
  const percent = data ? Math.round(data.cpuPercent) : null;
  return (
    <TileShell id="cpu" label={percent === null ? t("tile.cpu") : `${t("tile.cpu")} ${percent}%`}>
      <DotRing fraction={percent === null ? 0 : percent / PERCENT} />
      <span className="system__value">{percent === null ? "–" : percent}</span>
    </TileShell>
  );
}

export function BatteryFace() {
  const { data } = useProvider("battery");
  const percent = data ? Math.round(data.percent) : null;
  const onAc = data !== null && (data.charging || data.pluggedIn === true);
  const low = data !== null && !onAc && data.percent <= LOW_BATTERY;
  return (
    <TileShell id="battery" label={percent === null ? t("tile.battery.none") : `${t("tile.battery")} ${percent}%${data?.charging ? `, ${t("tile.battery.charging")}` : ""}`}>
      <DotRing fraction={percent === null ? 0 : percent / PERCENT} tone={low ? "var(--danger)" : "var(--accent)"} />
      <span className="system__value" data-low={low ? "true" : undefined}>
        {percent === null ? "–" : percent}
      </span>
    </TileShell>
  );
}

// Analog clock -----------------------------------------------------------------------------------------------------

const HOURS = 12;
const MINUTES = 60;
const HAND = { hour: 0.5, minute: 0.74 } as const;
const FACE_RADIUS = 44;
const CENTRE = 50;

const hand = (turns: number, length: number): { readonly x: number; readonly y: number } => ({
  x: CENTRE + Math.sin(turns * 2 * Math.PI) * length * FACE_RADIUS,
  y: CENTRE - Math.cos(turns * 2 * Math.PI) * length * FACE_RADIUS,
});

export function AnalogFace() {
  const now = useMinuteClock();
  const minutes = now.getMinutes();
  const hours = (now.getHours() % HOURS) + minutes / MINUTES;
  const h = hand(hours / HOURS, HAND.hour);
  const m = hand(minutes / MINUTES, HAND.minute);
  return (
    <TileShell id="analog" label={`${t("tile.analog")}, ${now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`}>
      <svg className="analog" viewBox="0 0 100 100" aria-hidden="true">
        {Array.from({ length: HOURS }, (_, i) => {
          const tick = hand(i / HOURS, 1);
          return <circle key={i} cx={tick.x} cy={tick.y} r={i % 3 === 0 ? 3 : 1.8} fill={i % 3 === 0 ? "var(--text)" : "var(--dot-off)"} />;
        })}
        <line x1={CENTRE} y1={CENTRE} x2={h.x} y2={h.y} stroke="var(--text)" strokeWidth="5" strokeLinecap="round" />
        <line x1={CENTRE} y1={CENTRE} x2={m.x} y2={m.y} stroke="var(--accent)" strokeWidth="3.4" strokeLinecap="round" />
        <circle cx={CENTRE} cy={CENTRE} r="3.6" fill="var(--text)" />
      </svg>
    </TileShell>
  );
}

// Notes ------------------------------------------------------------------------------------------------------------

export function NotesFace({ controls }: FaceProps) {
  const notes = useNotesStore((s) => s.notes);
  const lead = orderedNotes(notes)[0];
  const first = lead ? (lead.title.trim() || lead.body.trim().split("\n")[0] || t("tile.notes.untitled")) : t("tile.notes.none");
  return (
    <TileShell id="notes" label={[t("tile.notes"), first].join(", ")} controls={controls}>
      <Mark>
        <Icon name="note" />
      </Mark>
      <Words title={first} sub={notes.length > 0 ? plural("tile.notes.count", notes.length) : null} />
    </TileShell>
  );
}

// Colour picker ----------------------------------------------------------------------------------------------------

export function ColourFace({ controls }: FaceProps) {
  const last = useTools((s) => s.colours[0]);
  return (
    <TileShell id="colour" label={last ? `${t("tile.colour")}, ${last}` : t("tile.colour")} controls={controls}>
      <span className="swatch" style={last ? { background: last, color: inkFor(last) } : undefined} data-empty={last ? undefined : "true"}>
        <Icon name="picker" />
      </span>
    </TileShell>
  );
}

// Converter --------------------------------------------------------------------------------------------------------

/** "1 km = 0.621371 mi" for what is set up now, or what was typed when it is not a number. */
export function conversionText(setup: { readonly category: UnitCategory; readonly from: string; readonly to: string; readonly amount: string }, locale?: string): string | null {
  const amount = parseAmount(setup.amount);
  if (amount === null) return null;
  const result = convert(setup.category, setup.from, setup.to, amount);
  return `${formatNumber(amount, locale)} ${unitSymbol(setup.from, locale)} = ${formatNumber(result, locale)} ${unitSymbol(setup.to, locale)}`;
}

export function ConvertFace({ controls }: FaceProps) {
  const setup = useTools((s) => s.conversion);
  const text = conversionText(setup);
  return (
    <TileShell id="convert" label={[t("tile.convert"), text].filter((p) => p).join(", ")} controls={controls}>
      <Mark>
        <Icon name="swap" />
      </Mark>
      <Words title={text ?? t("tile.convert.invalid")} sub={t(`tile.convert.category.${setup.category}`)} />
    </TileShell>
  );
}

// Emoji ------------------------------------------------------------------------------------------------------------

export function EmojiFace({ controls }: FaceProps) {
  const recent = useTools((s) => s.emoji[0]);
  const shown = recent ?? emojiOf("faces")[0] ?? "";
  return (
    <TileShell id="emoji" label={t("tile.emoji")} controls={controls}>
      <span className="emoji" aria-hidden="true">
        {shown}
      </span>
    </TileShell>
  );
}

// World clock ------------------------------------------------------------------------------------------------------

export function WorldFace({ controls }: FaceProps) {
  const now = useMinuteClock();
  const cities = useTools((s) => s.cities);
  const rows = useMemo(() => worldRows(cities, now), [cities, now]);
  const [a, b] = rows;
  return (
    <TileShell id="world" label={[t("tile.world"), ...rows.map((r) => `${r.city.name} ${r.time}`)].join(", ")} controls={controls}>
      <Mark>
        <Icon name="globe" />
      </Mark>
      <Words title={a ? `${a.city.name} ${a.time}` : t("tile.world.none")} sub={b ? `${b.city.name} ${b.time}` : a ? null : t("tile.world.add")} />
    </TileShell>
  );
}

// Network ----------------------------------------------------------------------------------------------------------

export function NetworkFace({ controls }: FaceProps) {
  const read = readFeed(useFeed("network"));
  const record = useNetworkHistory((s) => s.push);
  const view = read.state === "ready" ? read.data : null;
  useEffect(() => {
    if (view) record({ at: Date.now(), down: view.downBytesPerSec, up: view.upBytesPerSec });
  }, [view, record]);
  return (
    <TileShell id="network" label={view ? `${t("tile.network")}, ${t("tile.network.down")} ${formatRate(view.downBytesPerSec)}, ${t("tile.network.up")} ${formatRate(view.upBytesPerSec)}` : t("tile.network")} state={read.state} controls={controls}>
      <Mark>
        <Icon name="arrow-down" />
      </Mark>
      <Words title={view ? formatRate(view.downBytesPerSec) : noData(read) || t("tile.network")} sub={view ? `↑ ${formatRate(view.upBytesPerSec)}` : null} />
    </TileShell>
  );
}

// Quick settings ---------------------------------------------------------------------------------------------------

export const TOGGLE_ICON: Readonly<Record<ToggleName, IconName>> = { wifi: "wifi", bluetooth: "bluetooth", nightLight: "moon", doNotDisturb: "bell" };

/** The switches on the tile itself; the popover has all of them and the brightness. */
export const FACE_TOGGLES: readonly ToggleName[] = ["wifi", "bluetooth", "nightLight"];

export const toggle = (name: ToggleName, on: boolean): void => void runTileCommand(tilesBackend().commands.toggles({ type: "switch", name, on }));

export function TogglesFace({ controls }: FaceProps) {
  const read = readFeed(useFeed("toggles"));
  const view: TogglesView | null = read.state === "ready" ? read.data : null;
  return (
    <TileShell id="toggles" label={t("tile.toggles")} state={read.state} controls={controls}>
      {FACE_TOGGLES.map((name) => {
        const on = view?.switches[name] ?? null;
        return (
          <button
            key={name}
            type="button"
            className="tile__toggle"
            aria-pressed={on === true}
            aria-label={t("tile.toggles.state", { name: t(`tile.toggles.${name}`), state: on === true ? t("tile.toggles.on") : on === false ? t("tile.toggles.off") : t("tile.toggles.missing") })}
            disabled={on === null}
            onClick={() => toggle(name, on !== true)}
          >
            <Icon name={TOGGLE_ICON[name]} />
          </button>
        );
      })}
    </TileShell>
  );
}
