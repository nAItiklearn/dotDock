/** Every widget the site can draw. See src/components/Widget.astro. */
export type WidgetKind =
  | "clock"
  | "date"
  | "calendar"
  | "ring"
  | "batpill"
  | "ram"
  | "disk"
  | "weather"
  | "forecast"
  | "music"
  | "timer"
  | "todo"
  | "photo";
