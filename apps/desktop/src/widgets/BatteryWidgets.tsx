import { DotIcon } from "../design-system/DotMatrix";
import { Icon } from "../design-system/Icon";
import { Caps, DotGrid, DotMeter, Numeral, Ring, Surface, type GaugeTone } from "../design-system/primitives";
import { formatHoursMinutes } from "../lib/format";
import { useProvider } from "../providers/store";
import type { BatteryData } from "../providers/types";
import type { ConfigSchema } from "./configSchema";
import { defineWidget, type WidgetProps } from "./definition";
import { sizeSpec, type SizeId, type SizeSpec } from "./sizes";
import { Freshness, WidgetNotice } from "./WidgetNotice";
import "./BatteryWidgets.css";

export interface BatteryConfig {
  /** Percent at or below which a discharging battery turns red. */
  readonly lowLevel: number;
  readonly showTimeLeft: boolean;
}

const BATTERY_SIZES: readonly SizeSpec[] = [
  { id: "m", name: "Ring", w: 2, h: 2 },
  { id: "s", name: "Pill", w: 3, h: 1 },
  { id: "l", name: "Dot grid", w: 4, h: 2 },
];

const BATTERY_SCHEMA: ConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    lowLevel: {
      type: "number",
      title: "Low battery level",
      description: "The gauge turns red at or below this level while discharging.",
      default: 20,
      minimum: 5,
      maximum: 50,
      multipleOf: 5,
      unit: "%",
    },
    showTimeLeft: { type: "boolean", title: "Show time remaining", default: true },
  },
};

const DEFAULT_CONFIG: BatteryConfig = { lowLevel: 20, showTimeLeft: true };

const GRID = { cols: 12, rows: 3, dot: 18, gap: 6 } as const;
const PILL_METER = { count: 12, dot: 6, gap: 4 } as const;
const RING_DIGITS = 34;
const GRID_DIGITS = 36;
const PILL_DIGITS = 26;
const RING_BOLT = 38;
const FULL = 100;

function onAc(data: BatteryData): boolean {
  return data.charging || data.pluggedIn === true;
}

function isLow(data: BatteryData, config: BatteryConfig): boolean {
  return !onAc(data) && data.percent <= config.lowLevel;
}

function tone(data: BatteryData, config: BatteryConfig): GaugeTone {
  return isLow(data, config) ? "danger" : "accent";
}

/** "Full in 1:12", "Charged", "2:07 left", or the plain state when Windows has no estimate. */
function statusText(data: BatteryData, showTime: boolean): string {
  const remaining = showTime ? formatHoursMinutes(data.secondsRemaining) : null;
  if (data.charging) {
    if (data.percent >= FULL) return "Charged";
    return remaining ? `Full in ${remaining}` : "Charging";
  }
  // On AC but not taking charge: full, or held at a charge limit by the laptop.
  if (data.pluggedIn === true) return data.percent >= FULL ? "Charged" : "Plugged in";
  return remaining ? `${remaining} left` : "On battery";
}

interface StatusIconProps {
  readonly data: BatteryData;
  readonly config: BatteryConfig;
  /** Big dotted bolt for the ring; a crisp line icon where space is tight. */
  readonly dotted?: boolean;
}

function StatusIcon({ data, config, dotted = false }: StatusIconProps) {
  const state = onAc(data) ? "on" : isLow(data, config) ? "low" : "idle";
  const className = `battery__icon battery__icon--${state}`;
  return dotted ? <DotIcon className={className} name="bolt" size={RING_BOLT} /> : <Icon className={className} name="bolt" />;
}

interface BatteryViewProps {
  readonly config?: BatteryConfig;
}

/** M circle: ring gauge with the percentage and state in the middle. */
export function BatteryRingWidget({ config = DEFAULT_CONFIG }: BatteryViewProps) {
  const state = useProvider("battery");
  const { data, issue } = state;
  const spec = sizeSpec(BATTERY_SIZES, "m");
  return (
    <Surface shape="circle" w={spec.w} h={spec.h} label={data ? `Battery ${data.percent} percent` : "Battery"}>
      {data ? (
        <Ring value={data.percent / FULL} tone={tone(data, config)}>
          <StatusIcon data={data} config={config} dotted />
          <Numeral value={data.percent.toString()} unit="%" height={RING_DIGITS} label={`${data.percent} percent`} />
          <Caps>{statusText(data, config.showTimeLeft)}</Caps>
        </Ring>
      ) : (
        <WidgetNotice title="Battery" issue={issue} message={issue === "no-device" ? "No battery" : undefined} />
      )}
      <Freshness state={state} />
    </Surface>
  );
}

/** S pill: percentage, state and a thin dot meter. */
export function BatteryPillWidget({ config = DEFAULT_CONFIG }: BatteryViewProps) {
  const state = useProvider("battery");
  const { data, issue } = state;
  const spec = sizeSpec(BATTERY_SIZES, "s");
  return (
    <Surface shape="pill" w={spec.w} h={spec.h} label={data ? `Battery ${data.percent} percent` : "Battery"}>
      {data ? (
        <div className="battery-pill">
          <StatusIcon data={data} config={config} />
          <Numeral value={data.percent.toString()} unit="%" height={PILL_DIGITS} label={`${data.percent} percent`} />
          <div className="battery-pill__side">
            <span className="battery-pill__state">{statusText(data, config.showTimeLeft)}</span>
            <DotMeter
              value={data.percent / FULL}
              count={PILL_METER.count}
              dot={PILL_METER.dot}
              gap={PILL_METER.gap}
              tone={tone(data, config)}
            />
          </div>
        </div>
      ) : (
        <WidgetNotice title="Battery" issue={issue} message={issue === "no-device" ? "No battery" : undefined} compact />
      )}
      <Freshness state={state} />
    </Surface>
  );
}

/** L card: percentage, state and a dot-grid gauge that fills like a rising level. */
export function BatteryGridWidget({ config = DEFAULT_CONFIG }: BatteryViewProps) {
  const state = useProvider("battery");
  const { data, issue } = state;
  const spec = sizeSpec(BATTERY_SIZES, "l");
  return (
    <Surface shape="card" w={spec.w} h={spec.h} label={data ? `Battery ${data.percent} percent` : "Battery"}>
      {data ? (
        <div className="battery-grid">
          <div className="battery-grid__head">
            <Numeral value={data.percent.toString()} unit="%" height={GRID_DIGITS} label={`${data.percent} percent`} />
            <div className="battery-grid__state">
              <StatusIcon data={data} config={config} />
              <Caps>{statusText(data, config.showTimeLeft)}</Caps>
            </div>
          </div>
          <DotGrid
            cols={GRID.cols}
            rows={GRID.rows}
            dot={GRID.dot}
            gap={GRID.gap}
            value={data.percent / FULL}
            tone={tone(data, config)}
          />
        </div>
      ) : (
        <WidgetNotice title="Battery" issue={issue} message={issue === "no-device" ? "No battery" : undefined} />
      )}
      <Freshness state={state} />
    </Surface>
  );
}

function BatteryWidget({ size, config }: { readonly size: SizeId; readonly config: BatteryConfig }) {
  if (size === "s") return <BatteryPillWidget config={config} />;
  if (size === "l") return <BatteryGridWidget config={config} />;
  return <BatteryRingWidget config={config} />;
}

export const batteryWidget = defineWidget<BatteryConfig>({
  id: "battery",
  name: "Battery",
  description: "Charge level, charging state and time remaining. Turns red when low.",
  category: "system",
  sizes: BATTERY_SIZES,
  providers: ["battery"],
  defaultConfig: DEFAULT_CONFIG,
  settingsSchema: BATTERY_SCHEMA,
  component: ({ config, size }: WidgetProps<BatteryConfig>) => <BatteryWidget size={size} config={config} />,
});
