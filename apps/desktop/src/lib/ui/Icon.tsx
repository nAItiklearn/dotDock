import { memo } from "react";

/** Builds a circle as path data so every glyph below is one uniform list of paths. */
const circle = (cx: number, cy: number, r: number): string =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

interface Glyph {
  /** Stroked outlines. */
  readonly line?: readonly string[];
  /** Filled shapes (small dots, solid halves). */
  readonly fill?: readonly string[];
}

/**
 * Original 24×24 line icons drawn for this app: one stroke weight, round caps, no external set.
 * Pairs well with mono caps labels and the dot-matrix display type.
 */
const GLYPHS = {
  home: { line: ["M4 11l8-7 8 7", "M6 9.5V19h12V9.5"] },
  appearance: { line: [circle(12, 12, 8.5)], fill: ["M12 3.5a8.5 8.5 0 0 1 0 17z"] },
  wallpaper: { line: ["M5.5 5h13a2.5 2.5 0 0 1 2.5 2.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-9A2.5 2.5 0 0 1 5.5 5z", "M4 17l4.5-4.5 3 3 2.5-2.5L20 18"], fill: [circle(9, 9.5, 1.3)] },
  widgets: { line: ["M5.5 4h4a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 9.5 11h-4A1.5 1.5 0 0 1 4 9.5v-4A1.5 1.5 0 0 1 5.5 4z", circle(16.5, 7.5, 3.5), "M5.5 13h4a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 9.5 20h-4A1.5 1.5 0 0 1 4 18.5v-4A1.5 1.5 0 0 1 5.5 13z", "M14.5 13h4a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-4a1.5 1.5 0 0 1 1.5-1.5z"] },
  power: { line: ["M12 3.5v8", "M7.3 6.6a7.5 7.5 0 1 0 9.4 0"] },
  display: { line: ["M5.5 5h13A2.5 2.5 0 0 1 21 7.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 14.5v-7A2.5 2.5 0 0 1 5.5 5z", "M9 20.5h6", "M12 17v3.5"] },
  gauge: { line: ["M4.6 17a8.5 8.5 0 1 1 14.8 0", "M12 14l3.6-4.4"], fill: [circle(12, 14, 1.2)] },
  keyboard: { line: ["M5.5 6.5h13A2.5 2.5 0 0 1 21 9v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16V9a2.5 2.5 0 0 1 2.5-2.5z", "M8 15h8"], fill: [circle(7, 11, 0.9), circle(10.3, 11, 0.9), circle(13.7, 11, 0.9), circle(17, 11, 0.9)] },
  privacy: { line: ["M12 3l7 2.8v5.4c0 4.5-3 7.6-7 9.8-4-2.2-7-5.3-7-9.8V5.8z", "M9 12l2.2 2.2L15.2 10"] },
  info: { line: [circle(12, 12, 8.5), "M12 11v5.5"], fill: [circle(12, 7.8, 1)] },
  search: { line: [circle(10.8, 10.8, 6.3), "M20 20l-4.7-4.7"] },
  check: { line: ["M5 12.5l4.6 4.6L19 7.6"] },
  close: { line: ["M6 6l12 12", "M18 6L6 18"] },
  plus: { line: ["M12 5v14", "M5 12h14"] },
  minus: { line: ["M5 12h14"] },
  undo: { line: ["M8 5L4 9l4 4", "M4 9h9a6 6 0 0 1 0 12h-4"] },
  redo: { line: ["M16 5l4 4-4 4", "M20 9h-9a6 6 0 0 0 0 12h4"] },
  lock: { line: ["M7.5 11h9A2.5 2.5 0 0 1 19 13.5v5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 18.5v-5A2.5 2.5 0 0 1 7.5 11z", "M8 11V8a4 4 0 0 1 8 0v3"] },
  unlock: { line: ["M7.5 11h9A2.5 2.5 0 0 1 19 13.5v5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 18.5v-5A2.5 2.5 0 0 1 7.5 11z", "M8 11V8a4 4 0 0 1 7.6-1.8"] },
  duplicate: { line: ["M10.5 8h7A2.5 2.5 0 0 1 20 10.5v7a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 8 17.5v-7A2.5 2.5 0 0 1 10.5 8z", "M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"] },
  trash: { line: ["M5 7h14", "M9.5 7V5h5v2", "M7 7l.8 12h8.4L17 7", "M10.2 11v5", "M13.8 11v5"] },
  edit: { line: ["M5 19l1-4L16.5 4.5l3 3L9 18z", "M14 7l3 3"] },
  chevron: { line: ["M9.5 6l6 6-6 6"] },
  up: { line: ["M12 19V5", "M6 11l6-6 6 6"] },
  down: { line: ["M12 5v14", "M6 13l6 6 6-6"] },
  download: { line: ["M12 4v11", "M7.5 10.8l4.5 4.5 4.5-4.5", "M5 19.5h14"] },
  upload: { line: ["M12 15.5v-11", "M7.5 9L12 4.5 16.5 9", "M5 19.5h14"] },
  reset: { line: ["M4.5 12a7.5 7.5 0 1 0 2.4-5.5", "M4.5 4.5v4h4"] },
  external: { line: ["M14 4h6v6", "M20 4l-9 9", "M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 18.5v-10A1.5 1.5 0 0 1 6.5 7H11"] },
  sun: { line: [circle(12, 12, 3.6), "M12 3.5v2", "M12 18.5v2", "M3.5 12h2", "M18.5 12h2", "M6 6l1.4 1.4", "M16.6 16.6L18 18", "M6 18l1.4-1.4", "M16.6 7.4L18 6"] },
  moon: { line: ["M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"] },
  clock: { line: [circle(12, 12, 8.5), "M12 7.5V12l3 2"] },
  resize: { line: ["M19 9.5L9.5 19", "M19 14.5L14.5 19"] },
  move: { line: ["M12 3.5v17", "M3.5 12h17", "M9.7 6L12 3.5 14.3 6", "M9.7 18L12 20.5 14.3 18", "M6 9.7L3.5 12 6 14.3", "M18 9.7l2.5 2.3-2.5 2.3"] },
  warning: { line: ["M12 4l9 15.5H3z", "M12 10v4.5"], fill: [circle(12, 17.2, 0.9)] },
  restore: { line: ["M5 12a7 7 0 1 1 2 5", "M5 18v-5h5"] },
  settings: { line: ["M4 8h8.5", "M17.5 8H20", circle(15, 8, 2.5), "M4 16h2.5", "M11.5 16H20", circle(9, 16, 2.5)] },
  /** A screen with the notch pill at its top edge. */
  notch: { line: ["M5.5 5h13A2.5 2.5 0 0 1 21 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-9A2.5 2.5 0 0 1 5.5 5z", "M9.5 8h5"] },
  /** A screen with the dock bar along its bottom edge. */
  dock: { line: ["M5.5 5h13A2.5 2.5 0 0 1 21 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-9A2.5 2.5 0 0 1 5.5 5z", "M8 15.5h8"] },
  /** Two stacked sheets: profiles, one arrangement over another. */
  layers: { line: ["M12 4l8 4-8 4-8-4z", "M4 12l8 4 8-4", "M4 16l8 4 8-4"] },
  folder: { line: ["M4.5 6h5l2 2.5h8A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V7.5A1.5 1.5 0 0 1 4.5 6z"] },
} as const satisfies Record<string, Glyph>;

export type IconName = keyof typeof GLYPHS;

export interface IconProps {
  readonly name: IconName;
  /** Pixel size; defaults to the 20px used across the UI. */
  readonly size?: number;
}

const DEFAULT_SIZE = 20;
const STROKE_WIDTH = 1.7;

export const Icon = memo(function Icon({ name, size = DEFAULT_SIZE }: IconProps) {
  const glyph: Glyph = GLYPHS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {glyph.line?.map((d) => <path key={d} d={d} />)}
      {glyph.fill?.map((d) => <path key={d} d={d} fill="currentColor" stroke="none" />)}
    </svg>
  );
});
