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

/** The pictures the photo widget can show on the site. */
export type PhotoName = "cake" | "ridge" | "meadow";

/** How the photo widget frames its picture: a paper mat, a round picture in a ring of dots, or a polaroid with a caption. */
export type PhotoFrame = "mat" | "ring" | "polaroid";
