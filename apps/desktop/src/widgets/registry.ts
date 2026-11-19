import { batteryWidget } from "./BatteryWidgets";
import { calendarWidget } from "./CalendarWidget";
import { clockWidget } from "./ClockWidget";
import { normalizeConfig, type ConfigValue } from "./configSchema";
import { dateWidget } from "./DateCircleWidget";
import type { WidgetDefinition } from "./definition";
import type { SizeId, SizeSpec } from "./sizes";
import { systemWidget } from "./SystemWidgets";
import { weatherWidget } from "./WeatherWidget";

/**
 * Each widget keeps its own config type. The registry erases it because hosts look
 * widgets up by a string id read from a layout file; `resolveConfig` is the checked way in.
 */
export type AnyWidgetDefinition = WidgetDefinition<any>;

/** Every widget, in gallery order. */
export const WIDGETS: readonly AnyWidgetDefinition[] = [
  clockWidget,
  dateWidget,
  calendarWidget,
  weatherWidget,
  batteryWidget,
  systemWidget,
];

const BY_ID: ReadonlyMap<string, AnyWidgetDefinition> = new Map(WIDGETS.map((w) => [w.id, w]));

export function getWidget(id: string): AnyWidgetDefinition | undefined {
  return BY_ID.get(id);
}

/** The first size is the default. */
export function defaultSize(def: AnyWidgetDefinition): SizeSpec {
  const first = def.sizes[0];
  if (!first) throw new Error(`Widget ${def.id} declares no sizes`);
  return first;
}

/** The requested size when the widget has it, otherwise its default size. */
export function resolveSize(def: AnyWidgetDefinition, id: string | undefined): SizeSpec {
  return def.sizes.find((s) => s.id === id) ?? defaultSize(def);
}

/** Stored or hand-edited config made valid: unknown keys dropped, bad values replaced by defaults. */
export function resolveConfig(def: AnyWidgetDefinition, raw: unknown): Record<string, ConfigValue> {
  return normalizeConfig(def.settingsSchema, raw);
}

/**
 * Kinds used by the first layout schema, mapped to the registry. A layout migration
 * replaces `{ kind }` with `{ widget, size, config }` using this table.
 */
export interface LegacyKindTarget {
  readonly widget: string;
  readonly size: SizeId;
  readonly config?: Readonly<Record<string, ConfigValue>>;
}

export const LEGACY_KINDS: Readonly<Record<string, LegacyKindTarget>> = {
  clock: { widget: "clock", size: "m" },
  "date-circle": { widget: "date", size: "s" },
  calendar: { widget: "calendar", size: "m" },
  "battery-ring": { widget: "battery", size: "m" },
  "battery-grid": { widget: "battery", size: "l" },
  ram: { widget: "system", size: "m", config: { metric: "ram" } },
  disk: { widget: "system", size: "m", config: { metric: "disk" } },
  weather: { widget: "weather", size: "s" },
};
