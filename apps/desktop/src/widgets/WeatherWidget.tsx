import { DotIcon, DotMatrix } from "../design-system/DotMatrix";
import { Caps, DotMeter, Ring, Surface } from "../design-system/primitives";
import { useProvider } from "../providers/store";
import type { WeatherData } from "../providers/types";
import type { ConfigSchema } from "./configSchema";
import { defineWidget, type WidgetProps } from "./definition";
import { defaultTemperatureUnit, displayTemperature, prefers24Hour, timeOfDay, type TemperatureUnit } from "./format";
import { sizeSpec, type SizeId, type SizeSpec } from "./sizes";
import { conditionIcon, conditionLabel, rangePosition } from "./weatherModel";
import { Freshness, WidgetNotice } from "./WidgetNotice";
import "./WeatherWidget.css";

export interface WeatherConfig {
  readonly unit: TemperatureUnit;
  readonly showPlace: boolean;
}

const WEATHER_SIZES: readonly SizeSpec[] = [
  { id: "s", name: "Pill", w: 3, h: 1 },
  { id: "m", name: "Range circle", w: 2, h: 2 },
  { id: "l", name: "Today", w: 4, h: 2 },
];

const DEFAULT_CONFIG: WeatherConfig = { unit: defaultTemperatureUnit(navigator.language), showPlace: true };

const WEATHER_SCHEMA: ConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    unit: {
      type: "string",
      title: "Temperature unit",
      default: DEFAULT_CONFIG.unit,
      oneOf: [
        { const: "c", title: "Celsius" },
        { const: "f", title: "Fahrenheit" },
      ],
    },
    showPlace: { type: "boolean", title: "Show place name", default: true, appliesToSizes: ["l"] },
  },
};

const PILL_DIGITS = 28;
const RING_DIGITS = 38;
const TODAY_DIGITS = 46;
const PILL_ICON = 46;
const RING_ICON = 38;
const TODAY_ICON = 52;
const RANGE_METER = { count: 16, dot: 6, gap: 4 } as const;
const DEGREE = "°";

interface View {
  readonly data: WeatherData;
  readonly config: WeatherConfig;
}

const temp = ({ data, config }: View): number => displayTemperature(data.temperatureC, config.unit);
const high = ({ data, config }: View): number => displayTemperature(data.highC, config.unit);
const low = ({ data, config }: View): number => displayTemperature(data.lowC, config.unit);
const unitLabel = (config: WeatherConfig): string => (config.unit === "f" ? "Fahrenheit" : "Celsius");
const summary = (v: View): string => `${temp(v)} degrees ${unitLabel(v.config)}, ${conditionLabel(v.data.code)}`;

const SETUP = "Set a city";

/** S pill: condition icon, temperature, condition and today's range. */
export function WeatherWidget({ config = DEFAULT_CONFIG }: { readonly config?: WeatherConfig }) {
  const state = useProvider("weather");
  const { data, issue } = state;
  const spec = sizeSpec(WEATHER_SIZES, "s");
  const view = data ? { data, config } : null;
  return (
    <Surface shape="pill" w={spec.w} h={spec.h} label={view ? summary(view) : "Weather"}>
      {view ? (
        <div className="weather weather--pill">
          <DotIcon name={conditionIcon(view.data.code, view.data.isDay)} size={PILL_ICON} />
          <DotMatrix text={`${temp(view)}${DEGREE}`} matrixStyle="blocks" height={PILL_DIGITS} label="" />
          <div className="weather__text">
            <span className="weather__condition">{conditionLabel(view.data.code)}</span>
            <Caps>
              {high(view)}
              {DEGREE} / {low(view)}
              {DEGREE}
            </Caps>
          </div>
        </div>
      ) : (
        <WidgetNotice title="Weather" issue={issue} message={issue === "needs-setup" ? SETUP : undefined} compact />
      )}
      <Freshness state={state} />
    </Surface>
  );
}

/** M circle: a ring shows where now sits between today's low and high. */
export function WeatherRangeWidget({ config = DEFAULT_CONFIG }: { readonly config?: WeatherConfig }) {
  const state = useProvider("weather");
  const { data, issue } = state;
  const spec = sizeSpec(WEATHER_SIZES, "m");
  const view = data ? { data, config } : null;
  return (
    <Surface shape="circle" w={spec.w} h={spec.h} label={view ? summary(view) : "Weather"}>
      {view ? (
        <Ring value={rangePosition(view.data.temperatureC, view.data.lowC, view.data.highC)}>
          <DotIcon name={conditionIcon(view.data.code, view.data.isDay)} size={RING_ICON} />
          <DotMatrix text={`${temp(view)}${DEGREE}`} matrixStyle="blocks" height={RING_DIGITS} label="" />
          <Caps>
            {low(view)}
            {DEGREE} · {high(view)}
            {DEGREE}
          </Caps>
        </Ring>
      ) : (
        <WidgetNotice title="Weather" issue={issue} message={issue === "needs-setup" ? SETUP : undefined} />
      )}
      <Freshness state={state} />
    </Surface>
  );
}

/** L card: big temperature, condition, place, and the day's range as a dot meter. */
export function WeatherTodayWidget({ config = DEFAULT_CONFIG }: { readonly config?: WeatherConfig }) {
  const state = useProvider("weather");
  const { data, issue } = state;
  const spec = sizeSpec(WEATHER_SIZES, "l");
  const view = data ? { data, config } : null;
  return (
    <Surface shape="card" w={spec.w} h={spec.h} label={view ? summary(view) : "Weather"}>
      {view ? (
        <div className="weather weather--today">
          <div className="weather__main">
            <DotIcon name={conditionIcon(view.data.code, view.data.isDay)} size={TODAY_ICON} />
            <DotMatrix text={`${temp(view)}${DEGREE}`} matrixStyle="blocks" height={TODAY_DIGITS} label="" />
          </div>
          <div className="weather__details">
            <div className="weather__text">
              <span className="weather__condition">{conditionLabel(view.data.code)}</span>
              {config.showPlace ? <Caps>{view.data.place}</Caps> : null}
            </div>
            <div className="weather__range">
              <DotMeter
                value={rangePosition(view.data.temperatureC, view.data.lowC, view.data.highC)}
                count={RANGE_METER.count}
                dot={RANGE_METER.dot}
                gap={RANGE_METER.gap}
              />
              <div className="weather__bounds tabular">
                <span>
                  {low(view)}
                  {DEGREE}
                </span>
                <span>Updated {timeOfDay(view.data.fetchedAt, prefers24Hour())}</span>
                <span>
                  {high(view)}
                  {DEGREE}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <WidgetNotice title="Weather" issue={issue} message={issue === "needs-setup" ? SETUP : undefined} />
      )}
      <Freshness state={state} />
    </Surface>
  );
}

function Weather({ size, config }: { readonly size: SizeId; readonly config: WeatherConfig }) {
  if (size === "m") return <WeatherRangeWidget config={config} />;
  if (size === "l") return <WeatherTodayWidget config={config} />;
  return <WeatherWidget config={config} />;
}

export const weatherWidget = defineWidget<WeatherConfig>({
  id: "weather",
  name: "Weather",
  description: "Current temperature and today's range from Open-Meteo, cached for offline use.",
  category: "info",
  sizes: WEATHER_SIZES,
  providers: ["weather"],
  defaultConfig: DEFAULT_CONFIG,
  settingsSchema: WEATHER_SCHEMA,
  component: ({ config, size }: WidgetProps<WeatherConfig>) => <Weather size={size} config={config} />,
});
