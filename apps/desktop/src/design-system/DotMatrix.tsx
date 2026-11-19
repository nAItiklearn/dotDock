import { memo } from "react";
import { buildMatrix, type MatrixStyle } from "./matrixGeometry";

export interface DotMatrixProps {
  readonly text: string;
  readonly matrixStyle: MatrixStyle;
  /** Height of the rendered text in CSS pixels; width follows the glyphs. */
  readonly height: number;
  /** Show unlit cells (dots style only). */
  readonly showOff?: boolean;
  readonly className?: string;
  readonly label?: string;
}

/** Crisp vector dot-matrix text. One path per colour, cached geometry. */
export const DotMatrix = memo(function DotMatrix({ text, matrixStyle, height, showOff = false, className, label }: DotMatrixProps) {
  const g = buildMatrix(text, matrixStyle);
  const width = (height / g.rows) * g.cols;
  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${g.cols} ${g.rows}`}
      role="img"
      aria-label={label ?? text}
      shapeRendering="geometricPrecision"
    >
      {showOff && g.offPath ? <path d={g.offPath} fill="var(--dot-off)" /> : null}
      <path d={g.litPath} fill="currentColor" />
    </svg>
  );
});
