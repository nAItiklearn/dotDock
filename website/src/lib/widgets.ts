/** Every widget the site can draw. See src/components/Widget.astro. */
export type WidgetKind =
  | "clock"
  | "date"
  | "ring"
  | "batpill"
  | "ram"
  | "disk"
  | "music"
  | "timer"
  | "photo";
