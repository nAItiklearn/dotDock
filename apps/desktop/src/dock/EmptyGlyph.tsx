import { memo } from "react";
import { circlePath } from "../design-system/matrixGeometry";
import { disc, outline, paint, raster } from "../design-system/rasterShapes";

/** A magnifier drawn in dots, for "nothing found". Rasterised from geometry so the ring stays round. */
const GRID = 15;
const LENS = { cx: 6.5, cy: 6.5, r: 5.4 } as const;
const HANDLE_FROM = 10.4;
const HANDLE_TO = 14;
const HANDLE_WIDTH = 0.85;

const ROWS = raster(
  GRID,
  paint(outline(disc(LENS.cx, LENS.cy, LENS.r)), "#"),
  paint((x, y) => Math.abs(x - y) * Math.SQRT1_2 < HANDLE_WIDTH && x > HANDLE_FROM && x < HANDLE_TO, "o"),
);

const DOT_RADIUS = 0.36;
const PATHS = (() => {
  const main: string[] = [];
  const accent: string[] = [];
  ROWS.forEach((row, r) =>
    [...row].forEach((cell, c) => {
      if (cell === ".") return;
      (cell === "o" ? accent : main).push(circlePath(c + 0.5, r + 0.5, DOT_RADIUS));
    }),
  );
  return { main: main.join(""), accent: accent.join("") };
})();

export const EmptyGlyph = memo(function EmptyGlyph({ size }: { readonly size: number }) {
  return (
    <svg className="doticon" width={size} height={size} viewBox={`0 0 ${GRID} ${GRID}`} aria-hidden="true" shapeRendering="geometricPrecision">
      <path d={PATHS.main} fill="currentColor" />
      <path d={PATHS.accent} fill="var(--accent)" />
    </svg>
  );
});
