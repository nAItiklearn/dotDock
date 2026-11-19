import type { ReactNode } from "react";
import type { MatrixStyle } from "../design-system/matrixGeometry";
import type { JsonObject } from "../lib/model/json";
import type { Placement } from "../lib/model/types";
import { BatteryGridWidget, BatteryRingWidget } from "../widgets/BatteryWidgets";
import { CalendarWidget } from "../widgets/CalendarWidget";
import { ClockWidget, type ClockConfig } from "../widgets/ClockWidget";
import { DateCircleWidget } from "../widgets/DateCircleWidget";
import { DiskWidget, RamWidget } from "../widgets/SystemWidgets";
import { WeatherWidget } from "../widgets/WeatherWidget";
import { BUILT_IN_WIDGET_META, CLOCK_DIGIT_HEIGHT } from "./widgetMeta";

/**
 * The only file that maps a widget kind to its React component. When the widget registry lands
 * (src/widgets/registry.ts), replace the body of `renderWidget` with a registry lookup and build
 * `widgetCatalog` from the registry's manifests; nothing else in the overlay or Settings changes.
 */
export type WidgetInstance = Pick<Placement, "kind" | "size" | "config">;

const MATRIX_STYLES: readonly MatrixStyle[] = ["blocks", "dots", "stripes"];
const DEFAULT_DIGIT_HEIGHT = CLOCK_DIGIT_HEIGHT["m"] ?? 128;

function flag(config: JsonObject, key: string, fallback: boolean): boolean {
  const value = config[key];
  return typeof value === "boolean" ? value : fallback;
}

function clockConfig(config: JsonObject, size: string): ClockConfig {
  const style = config["matrixStyle"];
  return {
    matrixStyle: MATRIX_STYLES.find((s) => s === style) ?? "blocks",
    hour24: flag(config, "hour24", true),
    showSeconds: flag(config, "showSeconds", false),
    blinkColon: flag(config, "blinkColon", false),
    height: CLOCK_DIGIT_HEIGHT[size] ?? DEFAULT_DIGIT_HEIGHT,
  };
}

/** Renders one widget instance, or null for a kind this build does not know. */
export function renderWidget({ kind, size, config }: WidgetInstance): ReactNode {
  switch (kind) {
    case "clock":
      return <ClockWidget config={clockConfig(config, size)} />;
    case "date-circle":
      return <DateCircleWidget />;
    case "calendar":
      return <CalendarWidget />;
    case "battery-ring":
      return <BatteryRingWidget />;
    case "battery-grid":
      return <BatteryGridWidget />;
    case "ram":
      return <RamWidget />;
    case "disk":
      return <DiskWidget />;
    case "weather":
      return <WeatherWidget />;
    default:
      return null;
  }
}

export const widgetCatalog = BUILT_IN_WIDGET_META;
