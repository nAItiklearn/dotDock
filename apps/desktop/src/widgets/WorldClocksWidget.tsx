import { DotMatrix } from "../design-system/DotMatrix";
import { Caps, Surface } from "../design-system/primitives";
import { useMinute } from "../providers/clock";
import type { ConfigSchema } from "./configSchema";
import { CITIES } from "./data/cities";
import { defineWidget, type WidgetProps } from "./definition";
import { clockParts, dayOffsetLabel, prefers24Hour } from "./format";
import { isDaylight, isDaylightByHour } from "./solar";
import { sizeSpec, type SizeId, type SizeSpec } from "./sizes";
import { WidgetNotice } from "./WidgetNotice";
import { fieldsDayDifference, formatUtcOffset, localFields, resolveZone, utcOffsetMinutes, zonedFields } from "./zones";
import "./WorldClocksWidget.css";

export interface WorldClocksConfig {
  /** City ids from the bundled list, in display order. */
  readonly cities: readonly string[];
  readonly hour24: boolean;
}

const WORLD_CLOCK_SIZES: readonly SizeSpec[] = [{ id: "m", name: "Four cities", w: 4, h: 2 }];

const MAX_CITIES = 4;
const TIME_DIGITS = 24;

const WORLD_SCHEMA: ConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    cities: {
      type: "array",
      title: "Cities",
      description: "Up to four, shown in this order.",
      default: ["new-york", "london", "dubai", "tokyo"],
      maxItems: MAX_CITIES,
      uniqueItems: true,
      items: { type: "string", oneOf: CITIES.map((c) => ({ const: c.id, title: c.name })) },
    },
    hour24: { type: "boolean", title: "24-hour clock", default: prefers24Hour() },
  },
};

const DEFAULT_CONFIG: WorldClocksConfig = {
  cities: ["new-york", "london", "dubai", "tokyo"],
  hour24: prefers24Hour(),
};

function Tile({ id, now, hour24 }: { readonly id: string; readonly now: Date; readonly hour24: boolean }) {
  const zone = resolveZone(id);
  const here = localFields(now);
  const there = zonedFields(now, zone.timeZone);
  const parts = clockParts(there, { hour24, leadingZero: true });
  const day = zone.coords ? isDaylight(now, zone.coords.lat, zone.coords.lon) : isDaylightByHour(there.hour);
  const text = `${parts.hours}:${parts.minutes}`;
  return (
    <li className="world__tile">
      <div className="world__top">
        <Caps>{zone.name}</Caps>
        <span
          className={`world__sun${day ? " world__sun--day" : ""}`}
          role="img"
          aria-label={day ? "Daytime" : "Night"}
        />
      </div>
      <div className="world__time">
        <DotMatrix text={text} matrixStyle="dots" height={TIME_DIGITS} label={`${text} ${parts.meridiem ?? ""}`.trim()} />
        {parts.meridiem ? <span className="world__meridiem">{parts.meridiem}</span> : null}
      </div>
      <div className="world__sub tabular">
        <span>{dayOffsetLabel(fieldsDayDifference(here, there))}</span>
        <span>{formatUtcOffset(utcOffsetMinutes(now, zone.timeZone))}</span>
      </div>
    </li>
  );
}

export function WorldClocksWidget({ config = DEFAULT_CONFIG }: { readonly size?: SizeId; readonly config?: WorldClocksConfig }) {
  const now = useMinute();
  const spec = sizeSpec(WORLD_CLOCK_SIZES, "m");
  const cities = config.cities.slice(0, MAX_CITIES);
  return (
    <Surface shape="card" w={spec.w} h={spec.h} label="World clocks">
      {cities.length === 0 ? (
        <WidgetNotice title="World clocks" issue="needs-setup" message="Pick up to four cities in settings" />
      ) : (
        <ul className={`world world--${cities.length}`}>
          {cities.map((id) => (
            <Tile key={id} id={id} now={now} hour24={config.hour24} />
          ))}
        </ul>
      )}
    </Surface>
  );
}

export const worldClocksWidget = defineWidget<WorldClocksConfig>({
  id: "world-clocks",
  name: "World clocks",
  description: "Up to four cities with a dot that shows whether the sun is up there.",
  category: "time",
  sizes: WORLD_CLOCK_SIZES,
  providers: [],
  defaultConfig: DEFAULT_CONFIG,
  settingsSchema: WORLD_SCHEMA,
  component: ({ config, size }: WidgetProps<WorldClocksConfig>) => <WorldClocksWidget size={size} config={config} />,
});
