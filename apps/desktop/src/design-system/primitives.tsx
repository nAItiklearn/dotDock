import { memo, type CSSProperties, type MouseEventHandler, type ReactNode } from "react";
import { DotMatrix } from "./DotMatrix";
import { Icon, type IconName } from "./Icon";
import { circlePath } from "./matrixGeometry";
import "./primitives.css";

const cellStyle = (w: number, h: number, extra?: CSSProperties): CSSProperties =>
  ({ "--w": w, "--h": h, ...extra }) as CSSProperties;

export interface CellBoxProps {
  /** Size in grid cells. */
  readonly w: number;
  readonly h: number;
  readonly className?: string;
  readonly children: ReactNode;
}

/** Transparent box that fills whole grid cells, for widgets drawn straight on the wallpaper. */
export function CellBox({ w, h, className, children }: CellBoxProps) {
  return (
    <div className={`cellbox${className ? ` ${className}` : ""}`} style={cellStyle(w, h)}>
      {children}
    </div>
  );
}

export type SurfaceShape = "card" | "pill" | "circle";

export interface SurfaceProps {
  readonly shape: SurfaceShape;
  /** Size in grid cells. */
  readonly w: number;
  readonly h: number;
  readonly children: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties | undefined;
  readonly label: string;
}

/** Widget body. Size is in grid cells so every widget lines up on the same grid. */
export function Surface({ shape, w, h, children, className, style, label }: SurfaceProps) {
  return (
    <section
      className={`surface surface--${shape}${className ? ` ${className}` : ""}`}
      style={cellStyle(w, h, style)}
      aria-label={label}
    >
      {children}
    </section>
  );
}

export type GaugeTone = "accent" | "danger";

const toneColor = (tone: GaugeTone): string => (tone === "danger" ? "var(--danger)" : "var(--accent)");

export interface RingProps {
  /** 0..1 */
  readonly value: number;
  readonly tone?: GaugeTone;
  readonly children?: ReactNode;
}

/** The ring is drawn in a 100-unit box and scales to its parent, so the same gauge fits every size. */
const RING_BOX = 100;
const RING_STROKE = 7;

/** Progress ring that starts at the top: accent on a dim track. Fills a square parent. */
export const Ring = memo(function Ring({ value, tone = "accent", children }: RingProps) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const r = (RING_BOX - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  const c = RING_BOX / 2;
  return (
    <div className="ring">
      <svg viewBox={`0 0 ${RING_BOX} ${RING_BOX}`} aria-hidden="true">
        <circle className="ring__track" cx={c} cy={c} r={r} strokeWidth={RING_STROKE} fill="none" />
        <circle
          className="ring__value"
          cx={c}
          cy={c}
          r={r}
          strokeWidth={RING_STROKE}
          fill="none"
          stroke={toneColor(tone)}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          transform={`rotate(-90 ${c} ${c})`}
        />
      </svg>
      <div className="ring__content">{children}</div>
    </div>
  );
});

export type DotFill = "columns" | "rows";

/** Number of lit dots for a 0..1 value, never lighting a dot for an empty gauge. */
export function litCount(value: number, total: number): number {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return Math.round(clamped * total);
}

/**
 * Cell index (row-major) of the n-th dot to light.
 * Columns fill left to right, each column bottom to top, so partial fills read as a rising level.
 */
export function fillOrder(cols: number, rows: number, fill: DotFill): readonly number[] {
  const order: number[] = [];
  if (fill === "rows") {
    for (let i = 0; i < cols * rows; i++) order.push(i);
    return order;
  }
  for (let c = 0; c < cols; c++) for (let r = rows - 1; r >= 0; r--) order.push(r * cols + c);
  return order;
}

export interface DotGridProps {
  readonly cols: number;
  readonly rows: number;
  /** 0..1 */
  readonly value: number;
  /** Dot diameter and gap in px. */
  readonly dot: number;
  readonly gap: number;
  readonly fill?: DotFill;
  readonly tone?: GaugeTone;
}

/** Gauge made of discrete dots: lit dots in the tone colour, the rest dim. */
export const DotGrid = memo(function DotGrid({ cols, rows, value, dot, gap, fill = "columns", tone = "accent" }: DotGridProps) {
  const total = cols * rows;
  const lit = new Set(fillOrder(cols, rows, fill).slice(0, litCount(value, total)));
  const pitch = dot + gap;
  const width = cols * pitch - gap;
  const height = rows * pitch - gap;
  const r = dot / 2;
  let on = "";
  let off = "";
  for (let i = 0; i < total; i++) {
    const d = circlePath((i % cols) * pitch + r, Math.floor(i / cols) * pitch + r, r);
    if (lit.has(i)) on += d;
    else off += d;
  }
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="dotgrid">
      <path d={off} fill="var(--dot-off)" />
      <path d={on} fill={toneColor(tone)} />
    </svg>
  );
});

export interface DotArcProps {
  /** 0..1 */
  readonly value: number;
  /** Dots along the arc. */
  readonly count: number;
  /** Arc radius, centre of the dots, in px. */
  readonly radius: number;
  readonly dot: number;
  readonly tone?: GaugeTone;
}

/** Half-circle gauge drawn with dots, left to right over the top. */
export const DotArc = memo(function DotArc({ value, count, radius, dot, tone = "accent" }: DotArcProps) {
  const r = dot / 2;
  const width = 2 * radius + dot;
  const height = radius + dot;
  const lit = litCount(value, count);
  let on = "";
  let off = "";
  for (let i = 0; i < count; i++) {
    const angle = Math.PI - (i / (count - 1)) * Math.PI;
    const d = circlePath(radius + r + radius * Math.cos(angle), radius + r - radius * Math.sin(angle), r);
    if (i < lit) on += d;
    else off += d;
  }
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="dotarc">
      <path d={off} fill="var(--dot-off)" />
      <path d={on} fill={toneColor(tone)} />
    </svg>
  );
});

export interface DotMeterProps {
  /** 0..1 */
  readonly value: number;
  readonly count: number;
  readonly dot: number;
  readonly gap: number;
  readonly tone?: GaugeTone;
}

/** One row of dots as a progress bar. The frontier dot fades in so progress never jumps. */
export const DotMeter = memo(function DotMeter({ value, count, dot, gap, tone = "accent" }: DotMeterProps) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const exact = clamped * count;
  const full = Math.floor(exact);
  const partial = exact - full;
  const pitch = dot + gap;
  const r = dot / 2;
  let on = "";
  let off = "";
  for (let i = 0; i < count; i++) {
    const d = circlePath(i * pitch + r, r, r);
    if (i < full) on += d;
    else off += d;
  }
  const width = count * pitch - gap;
  return (
    <svg width={width} height={dot} viewBox={`0 0 ${width} ${dot}`} aria-hidden="true" className="dotmeter">
      <path d={off} fill="var(--dot-off)" />
      <path d={on} fill={toneColor(tone)} />
      {full < count && partial > 0 ? (
        <path d={circlePath(full * pitch + r, r, r)} fill={toneColor(tone)} fillOpacity={partial} />
      ) : null}
    </svg>
  );
});

export function Caps({ children, accent = false }: { readonly children: ReactNode; readonly accent?: boolean }) {
  return <span className={`caps${accent ? " caps--accent" : ""}`}>{children}</span>;
}

/** Display number: dot-matrix digits with a small mono unit beside them. */
const UNIT_SCALE = 0.4;

export interface NumeralProps {
  readonly value: string;
  readonly unit?: string;
  readonly height: number;
  readonly label: string;
  readonly style?: "blocks" | "dots";
}

export const Numeral = memo(function Numeral({ value, unit, height, label, style = "blocks" }: NumeralProps) {
  return (
    <span className="numeral" role="img" aria-label={label}>
      <DotMatrix text={value} matrixStyle={style} height={height} label="" />
      {unit ? (
        <span className="numeral__unit" style={{ fontSize: height * UNIT_SCALE }} aria-hidden="true">
          {unit}
        </span>
      ) : null}
    </span>
  );
});

export type ButtonTone = "plain" | "accent" | "ghost";

export interface IconButtonProps {
  readonly icon: IconName;
  readonly label: string;
  readonly onClick: MouseEventHandler<HTMLButtonElement>;
  /** Diameter token: sm, md or lg (see --control-* in tokens.css). */
  readonly size?: "sm" | "md" | "lg";
  readonly tone?: ButtonTone;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
}

/** Round button with a dot pictogram. Hover and press are transforms only. */
export function IconButton({
  icon,
  label,
  onClick,
  size = "md",
  tone = "plain",
  disabled = false,
  pressed,
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-button icon-button--${tone} icon-button--${size}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
    >
      <Icon name={icon} />
    </button>
  );
}
