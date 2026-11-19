import type { WidgetCatalogMeta, WidgetMeta } from "../lib/model/types";

/**
 * Pure-data description of the built-in widgets: footprints, defaults and the fields that
 * generate each widget's settings form. No React in here, so layout code and tests can use it.
 *
 * The clock draws on the wallpaper without a card, so its footprint is derived from the digit
 * height: digits plus the weekday row must fit the declared cells.
 */
export const CLOCK_DIGIT_HEIGHT: Readonly<Record<string, number>> = { s: 40, m: 128, l: 216 };

const STANDARD = "m";

const CLOCK: WidgetMeta = {
  kind: "clock",
  name: "Clock",
  description: "Dot-matrix time with the weekday underneath.",
  sizes: [
    { id: "s", label: "Small", w: 2, h: 1 },
    { id: "m", label: "Medium", w: 6, h: 2 },
    { id: "l", label: "Large", w: 9, h: 3 },
  ],
  defaultSize: "m",
  defaultConfig: { matrixStyle: "blocks", hour24: true, showSeconds: false, blinkColon: false },
  fields: [
    {
      type: "choice",
      key: "matrixStyle",
      label: "Digit style",
      options: [
        { value: "blocks", label: "Blocks" },
        { value: "dots", label: "Dots" },
        { value: "stripes", label: "Stripes" },
      ],
    },
    { type: "toggle", key: "hour24", label: "24-hour time" },
    { type: "toggle", key: "showSeconds", label: "Show seconds" },
    { type: "toggle", key: "blinkColon", label: "Blink the colon" },
  ],
};

function single(kind: string, name: string, description: string, w: number, h: number): WidgetMeta {
  return {
    kind,
    name,
    description,
    sizes: [{ id: STANDARD, label: "Standard", w, h }],
    defaultSize: STANDARD,
    defaultConfig: {},
    fields: [],
  };
}

const BUILT_IN: readonly WidgetMeta[] = [
  CLOCK,
  single("date-circle", "Date", "Today's date in pixel numerals, weekday in the accent colour.", 2, 2),
  single("calendar", "Calendar", "The current month with today circled.", 3, 2),
  single("battery-ring", "Battery ring", "Charge level as a ring around the percentage.", 2, 2),
  single("battery-grid", "Battery grid", "Charge level as a dot grid with time remaining.", 4, 2),
  single("ram", "Memory", "Memory in use as a dot grid.", 2, 2),
  single("disk", "Disk", "Space used on the system drive.", 2, 2),
  single("weather", "Weather", "Current temperature and conditions.", 3, 1),
];

const BY_KIND = new Map(BUILT_IN.map((m) => [m.kind, m] as const));

export const BUILT_IN_WIDGET_META: WidgetCatalogMeta = {
  list: () => BUILT_IN,
  get: (kind) => BY_KIND.get(kind),
};
