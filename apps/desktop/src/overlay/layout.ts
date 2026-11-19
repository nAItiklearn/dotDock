import type { ClockConfig } from "../widgets/ClockWidget";

export type WidgetKind =
  | "clock"
  | "date-circle"
  | "calendar"
  | "battery-ring"
  | "battery-grid"
  | "ram"
  | "disk"
  | "weather";

interface PlacementBase {
  readonly id: string;
  /** Top-left position in grid cells. */
  readonly x: number;
  readonly y: number;
}

export type Placement =
  | (PlacementBase & { readonly kind: "clock"; readonly config: ClockConfig })
  | (PlacementBase & { readonly kind: Exclude<WidgetKind, "clock"> });

export interface Layout {
  readonly schema: 1;
  readonly placements: readonly Placement[];
}

const CLOCK_HEIGHT = 128;

/** First-run layout, modelled on the reference desktop: clock top-left, widgets below. */
export const DEFAULT_LAYOUT: Layout = {
  schema: 1,
  placements: [
    {
      id: "clock-1",
      kind: "clock",
      x: 0,
      y: 0,
      config: { matrixStyle: "blocks", hour24: true, showSeconds: false, blinkColon: false, height: CLOCK_HEIGHT },
    },
    { id: "battery-ring-1", kind: "battery-ring", x: 0, y: 2 },
    { id: "calendar-1", kind: "calendar", x: 2, y: 2 },
    { id: "date-circle-1", kind: "date-circle", x: 5, y: 2 },
    { id: "ram-1", kind: "ram", x: 0, y: 4 },
    { id: "disk-1", kind: "disk", x: 2, y: 4 },
    { id: "battery-grid-1", kind: "battery-grid", x: 4, y: 5 },
  ],
};
