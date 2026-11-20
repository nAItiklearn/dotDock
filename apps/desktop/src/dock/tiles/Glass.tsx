import { memo } from "react";
import { hydrationFill, glassDots } from "./wave";

/** Dots across the compact glass on the dock. */
export const GLASS_SMALL = 9;
/** Dots across the glass in the popover. */
export const GLASS_LARGE = 21;

const DOT = 0.38;

export interface GlassDotsProps {
  readonly loggedMl: number;
  readonly goalMl: number;
  readonly size?: number;
}

/** A round glass of dots, filled from the bottom to the share of the goal drunk, with a wavy surface. */
export const GlassDots = memo(function GlassDots({ loggedMl, goalMl, size = GLASS_SMALL }: GlassDotsProps) {
  const dots = glassDots(hydrationFill(loggedMl, goalMl), size);
  return (
    <svg className="glass" viewBox={`0 0 ${size} ${size}`} aria-hidden="true" shapeRendering="geometricPrecision">
      {dots.map((d) => (
        <circle key={`${d.col}:${d.row}`} cx={d.col + 0.5} cy={d.row + 0.5} r={DOT} fill={d.lit ? "var(--accent)" : "var(--dot-off)"} />
      ))}
    </svg>
  );
});
