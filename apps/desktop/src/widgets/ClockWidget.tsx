import { DotMatrix } from "../design-system/DotMatrix";
import type { MatrixStyle } from "../design-system/matrixGeometry";
import { CellBox, Caps, Surface } from "../design-system/primitives";
import { useMinute, useNow } from "../providers/clock";
import type { ConfigSchema } from "./configSchema";
import { defineWidget, type WidgetProps } from "./definition";
import { CITIES } from "./data/cities";
import { clockParts, prefers24Hour, type ClockParts } from "./format";
import type { SizeId, SizeSpec } from "./sizes";
import { sizeSpec } from "./sizes";
import { LOCAL_ZONE, localFields, resolveZone, zonedFields } from "./zones";
import "./ClockWidget.css";

/** The four matrix styles plus the pill plate. The config key keeps its original name, `matrixStyle`. */
export type ClockStyle = MatrixStyle | "pill";

export interface ClockConfig {
  readonly matrixStyle: ClockStyle;
  readonly hour24: boolean;
  readonly showSeconds: boolean;
  readonly blinkColon: boolean;
  /** Show 09:05 instead of 9:05. */
  readonly leadingZero?: boolean;
  /** City id from the bundled list, or "local" for this device. */
  readonly zone?: string;
  /** Explicit digit height in px. Overrides the size's fitted height; set by older layouts. */
  readonly height?: number;
}

const CLOCK_SIZES: readonly SizeSpec[] = [
  { id: "m", name: "Compact", w: 4, h: 2 },
  { id: "l", name: "Stacked", w: 4, h: 4 },
  { id: "xl", name: "Wide", w: 8, h: 4 },
];

const CLOCK_STYLES = [
  { const: "blocks", title: "Split bold" },
  { const: "circles", title: "Filled circles" },
  { const: "stripes", title: "Striped lines" },
  { const: "dots", title: "Dot matrix" },
  { const: "pill", title: "Pill" },
] as const;

const CLOCK_SCHEMA: ConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    matrixStyle: { type: "string", title: "Style", default: "blocks", oneOf: CLOCK_STYLES },
    hour24: { type: "boolean", title: "24-hour clock", default: prefers24Hour() },
    leadingZero: { type: "boolean", title: "Leading zero", default: true },
    showSeconds: { type: "boolean", title: "Show seconds", default: false },
    blinkColon: {
      type: "boolean",
      title: "Blink the colon",
      default: false,
      appliesToSizes: ["m", "xl"],
    },
    zone: {
      type: "string",
      title: "Time zone",
      default: LOCAL_ZONE,
      oneOf: [{ const: LOCAL_ZONE, title: "This device" }, ...CITIES.map((c) => ({ const: c.id, title: c.name }))],
    },
  },
};

const timeZoneOption = (zone: string): { timeZone?: string } => (zone === LOCAL_ZONE ? {} : { timeZone: resolveZone(zone).timeZone });

interface ClockViewProps {
  readonly now: Date;
  readonly config: ClockConfig;
  readonly size: SizeId;
}

/** Everything shown for one instant, already formatted. */
function describe(now: Date, config: ClockConfig) {
  const zone = config.zone ?? LOCAL_ZONE;
  const resolved = zone === LOCAL_ZONE ? null : resolveZone(zone);
  const fields = resolved ? zonedFields(now, resolved.timeZone) : localFields(now);
  const parts: ClockParts = clockParts(fields, { hour24: config.hour24, leadingZero: config.leadingZero ?? true });
  const zoneOption = timeZoneOption(zone);
  return {
    parts,
    weekday: now.toLocaleDateString(undefined, { weekday: "long", ...zoneOption }),
    date: now.toLocaleDateString(undefined, { day: "numeric", month: "long", ...zoneOption }),
    place: resolved?.name ?? null,
  };
}

function Meta({ info, config, size }: { info: ReturnType<typeof describe>; config: ClockConfig; size: SizeId }) {
  return (
    <div className="clock__meta">
      <span className="clock__marker" aria-hidden="true" />
      <Caps>{info.place ? `${info.weekday} · ${info.place}` : info.weekday}</Caps>
      {size !== "m" ? <Caps>{info.date}</Caps> : null}
      {info.parts.meridiem ? <Caps>{info.parts.meridiem}</Caps> : null}
      {config.showSeconds ? <span className="clock__seconds tabular">{info.parts.seconds}</span> : null}
    </div>
  );
}

function ClockView({ now, config, size }: ClockViewProps) {
  const info = describe(now, config);
  const { hours, minutes } = info.parts;
  const style = config.matrixStyle;
  const stacked = size === "l";
  const label = `${hours}:${minutes}`;

  if (style === "pill") {
    const spec = sizeSpec(CLOCK_SIZES, size);
    return (
      <Surface shape="pill" w={spec.w} h={spec.h} label={label} className={`clock-pill clock-pill--${size}`}>
        <div className="clock__plate">
          {stacked ? (
            <div className="clock__stack">
              <div className="clock__line">
                <DotMatrix text={hours} matrixStyle="dots" height="fit" align="center" label={hours} />
              </div>
              <div className="clock__line">
                <DotMatrix text={minutes} matrixStyle="dots" height="fit" align="center" label={minutes} />
              </div>
            </div>
          ) : (
            <div className="clock__face">
              <DotMatrix text={label} matrixStyle="dots" height="fit" align="center" blinkColon={config.blinkColon} label={label} />
            </div>
          )}
          <div className="clock__meta clock__meta--center">
            <Caps accent>{info.weekday}</Caps>
            {info.parts.meridiem ? <Caps>{info.parts.meridiem}</Caps> : null}
            {config.showSeconds ? <span className="clock__seconds tabular">{info.parts.seconds}</span> : null}
          </div>
        </div>
      </Surface>
    );
  }

  const spec = sizeSpec(CLOCK_SIZES, size);
  return (
    <CellBox w={spec.w} h={spec.h} className={`clock clock--${style} clock--${size}`}>
      {stacked ? (
        <div className="clock__stack">
          <div className="clock__line">
            <DotMatrix text={hours} matrixStyle={style} height="fit" align="bottom-left" label={hours} />
          </div>
          <div className="clock__line">
            <DotMatrix text={minutes} matrixStyle={style} height="fit" align="bottom-left" label={minutes} />
          </div>
        </div>
      ) : (
        <div className="clock__face">
          <DotMatrix
            text={label}
            matrixStyle={style}
            height={config.height ?? "fit"}
            align="bottom-left"
            blinkColon={config.blinkColon}
            showOff={style === "dots" && size === "xl"}
            label={label}
          />
        </div>
      )}
      <Meta info={info} config={config} size={size} />
    </CellBox>
  );
}

function ClockWithSeconds(props: Omit<ClockViewProps, "now">) {
  return <ClockView now={useNow()} {...props} />;
}

function ClockByMinute(props: Omit<ClockViewProps, "now">) {
  return <ClockView now={useMinute()} {...props} />;
}

/** Display clock. Styles: split bold, filled circles, striped lines, dot matrix and a pill plate. */
export function ClockWidget({ config, size = "m" }: { readonly config: ClockConfig; readonly size?: SizeId }) {
  return config.showSeconds ? <ClockWithSeconds config={config} size={size} /> : <ClockByMinute config={config} size={size} />;
}

export const clockWidget = defineWidget<ClockConfig>({
  id: "clock",
  name: "Clock",
  description: "Large dot-matrix time in five styles, with optional seconds and any city's time zone.",
  category: "time",
  sizes: CLOCK_SIZES,
  providers: [],
  defaultConfig: {
    matrixStyle: "blocks",
    hour24: prefers24Hour(),
    leadingZero: true,
    showSeconds: false,
    blinkColon: false,
    zone: LOCAL_ZONE,
  },
  settingsSchema: CLOCK_SCHEMA,
  component: ({ config, size }: WidgetProps<ClockConfig>) => <ClockWidget config={config} size={size} />,
});
