import { memo, type CSSProperties, type ReactNode } from "react";
import "./primitives.css";

export type SurfaceShape = "card" | "pill" | "circle";

export interface SurfaceProps {
  readonly shape: SurfaceShape;
  /** Size in grid cells. */
  readonly w: number;
  readonly h: number;
  readonly children: ReactNode;
  readonly className?: string;
  readonly label: string;
}

/** Widget body. Size is in grid cells so every widget lines up on the same grid. */
export function Surface({ shape, w, h, children, className, label }: SurfaceProps) {
  return (
    <section
      className={`surface surface--${shape}${className ? ` ${className}` : ""}`}
      style={{ "--w": w, "--h": h } as CSSProperties}
      aria-label={label}
    >
      {children}
    </section>
  );
}

export interface RingProps {
  /** 0..1 */
  readonly value: number;
  /** Outer diameter in px. */
  readonly size: number;
  readonly stroke: number;
  readonly children?: ReactNode;
}

/** Progress ring starting at 12 o'clock, accent on a dim track. */
export const Ring = memo(function Ring({ value, size, stroke, children }: RingProps) {
  const clamped = Math.min(1, Math.max(0, value));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ring__track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        <circle
          className="ring__value"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring__content">{children}</div>
    </div>
  );
});

export interface DotGridProps {
  readonly cols: number;
  readonly rows: number;
  /** 0..1, fills row by row from the top-left. */
  readonly value: number;
  /** Dot diameter and gap in px. */
  readonly dot: number;
  readonly gap: number;
}

/** Gauge made of discrete dots: lit dots in accent, the rest dim. */
export const DotGrid = memo(function DotGrid({ cols, rows, value, dot, gap }: DotGridProps) {
  const total = cols * rows;
  const lit = Math.round(Math.min(1, Math.max(0, value)) * total);
  const pitch = dot + gap;
  const width = cols * pitch - gap;
  const height = rows * pitch - gap;
  let on = "";
  let off = "";
  const r = dot / 2;
  for (let i = 0; i < total; i++) {
    const cx = (i % cols) * pitch + r;
    const cy = Math.floor(i / cols) * pitch + r;
    const d = `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${dot} 0a${r} ${r} 0 1 0 ${-dot} 0Z`;
    if (i < lit) on += d;
    else off += d;
  }
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="dotgrid">
      <path d={off} fill="var(--dot-off)" />
      <path d={on} fill="var(--accent)" />
    </svg>
  );
});

export function Caps({ children, accent = false }: { readonly children: ReactNode; readonly accent?: boolean }) {
  return <span className={`caps${accent ? " caps--accent" : ""}`}>{children}</span>;
}
