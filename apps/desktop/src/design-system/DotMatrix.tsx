import { memo, type CSSProperties } from "react";
import { buildIcon, type DotIconName } from "./icons";
import { buildMatrix, type MatrixStyle } from "./matrixGeometry";
import "./dotMatrix.css";

const ASPECT = {
  left: "xMinYMid meet",
  center: "xMidYMid meet",
  "bottom-left": "xMinYMax meet",
} as const;

export interface DotMatrixProps {
  readonly text: string;
  readonly matrixStyle: MatrixStyle;
  /**
   * Height of the rendered text in CSS pixels (width follows the glyphs), or "fit" to
   * scale into the parent box, which must have a definite size.
   */
  readonly height: number | "fit";
  /** Where "fit" text sits inside a box that is wider or taller than the text. */
  readonly align?: keyof typeof ASPECT;
  /** Show unlit cells (dots style only). */
  readonly showOff?: boolean;
  /** Blink the colon once a second, in step with the wall clock. */
  readonly blinkColon?: boolean;
  readonly className?: string;
  readonly label?: string;
}

const MS_PER_SECOND = 1000;

/** Crisp vector dot-matrix text. One path per paint, cached geometry. */
export const DotMatrix = memo(function DotMatrix({
  text,
  matrixStyle,
  height,
  align = "left",
  showOff = false,
  blinkColon = false,
  className,
  label,
}: DotMatrixProps) {
  const g = buildMatrix(text, matrixStyle);
  const fit = height === "fit";
  return (
    <svg
      className={`dotmatrix${blinkColon ? " dotmatrix--blink" : ""}${fit ? " dotmatrix--fit" : ""}${className ? ` ${className}` : ""}`}
      style={blinkColon ? ({ "--blink-offset": `${-(Date.now() % MS_PER_SECOND)}ms` } as CSSProperties) : undefined}
      width={fit ? undefined : (height / g.rows) * g.cols}
      height={fit ? undefined : height}
      viewBox={`0 0 ${g.cols} ${g.rows}`}
      preserveAspectRatio={ASPECT[align]}
      role={label === "" ? "presentation" : "img"}
      aria-label={label === "" ? undefined : (label ?? text)}
      shapeRendering="geometricPrecision"
    >
      {showOff && g.offPath ? <path d={g.offPath} fill="var(--dot-off)" /> : null}
      <path d={g.litPath} fill="currentColor" />
      {g.blinkPath ? <path className="dotmatrix__colon" d={g.blinkPath} fill="currentColor" /> : null}
      {g.accentPath ? <path d={g.accentPath} fill="var(--accent)" /> : null}
    </svg>
  );
});

export interface DotIconProps {
  readonly name: DotIconName;
  /** Rendered height in CSS pixels. */
  readonly size?: number;
  readonly className?: string;
}

/** Decorative pictogram built from dots. Pair it with a text label for meaning. */
export const DotIcon = memo(function DotIcon({ name, size, className }: DotIconProps) {
  const g = buildIcon(name);
  return (
    <svg
      className={`doticon${className ? ` ${className}` : ""}`}
      width={size === undefined ? undefined : (size / g.rows) * g.cols}
      height={size}
      viewBox={`0 0 ${g.cols} ${g.rows}`}
      aria-hidden="true"
      shapeRendering="geometricPrecision"
    >
      <path d={g.path} fill="currentColor" />
    </svg>
  );
});
