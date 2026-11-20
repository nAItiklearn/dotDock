import { memo } from "react";

const BOX = 40;
const CENTRE = BOX / 2;
const RADIUS = 15.5;
const DOT = 2.3;

export interface DotRingProps {
  /** How much of the ring is lit, 0 to 1. */
  readonly fraction: number;
  readonly dots?: number;
  /** CSS colour of the lit dots. */
  readonly tone?: string;
}

/** A ring of dots lit clockwise from the top: how full, how far, how loud. Sized by its container. */
export const DotRing = memo(function DotRing({ fraction, dots = 12, tone = "var(--accent)" }: DotRingProps) {
  const lit = Math.round(Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0)) * dots);
  return (
    <svg className="dot-ring" viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden="true">
      {Array.from({ length: dots }, (_, i) => {
        const angle = (i / dots) * Math.PI * 2 - Math.PI / 2;
        return <circle key={i} cx={CENTRE + Math.cos(angle) * RADIUS} cy={CENTRE + Math.sin(angle) * RADIUS} r={DOT} fill={i < lit ? tone : "var(--dot-off)"} />;
      })}
    </svg>
  );
});
