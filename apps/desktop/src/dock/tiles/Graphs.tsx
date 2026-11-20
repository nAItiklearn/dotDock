import { memo } from "react";
import { gridCells, type PeriodGrid } from "./period";

const DOT = 0.36;

export interface DotGraphProps {
  /** Lit dots per column, from the bottom. */
  readonly levels: readonly number[];
  readonly rows: number;
}

/** A bar graph drawn in dots: one column per slice of time, as tall as the load was. */
export const DotGraph = memo(function DotGraph({ levels, rows }: DotGraphProps) {
  return (
    <svg className="graph" viewBox={`0 0 ${levels.length} ${rows}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" shapeRendering="geometricPrecision">
      {levels.flatMap((level, col) =>
        Array.from({ length: rows }, (_, row) => (
          <circle key={`${col}:${row}`} cx={col + 0.5} cy={row + 0.5} r={DOT} fill={rows - row <= level ? "var(--accent)" : "var(--dot-off)"} />
        )),
      )}
    </svg>
  );
});

/** A day, month or year as a grid of dots: over, now (in the accent) and still to come. */
export const PeriodDots = memo(function PeriodDots({ grid }: { readonly grid: PeriodGrid }) {
  return (
    <svg className="graph graph--period" viewBox={`0 0 ${grid.cols} ${grid.rows}`} preserveAspectRatio="xMinYMid meet" aria-hidden="true" shapeRendering="geometricPrecision">
      {gridCells(grid).map((cell) => (
        <circle
          key={`${cell.col}:${cell.row}`}
          cx={cell.col + 0.5}
          cy={cell.row + 0.5}
          r={DOT}
          fill={cell.state === "past" ? "var(--text)" : cell.state === "current" ? "var(--accent)" : "var(--dot-off)"}
        />
      ))}
    </svg>
  );
});
