import type { CSSProperties } from "react";
import { spanPx, type GridMetrics } from "../lib/layout/grid";
import type { JsonObject } from "../lib/model/json";
import type { WidgetInfo } from "../lib/model/types";
import { WidgetView } from "../widgets/WidgetView";
import "./WidgetPreview.css";

export interface WidgetPreviewProps {
  readonly meta: WidgetInfo;
  readonly sizeId: string;
  readonly config?: JsonObject;
  readonly metrics: GridMetrics;
  /** The preview shrinks to fit this box but is never enlarged past real size. */
  readonly maxWidth: number;
  readonly maxHeight: number;
}

/** The real widget, live, scaled down into a card. Inert: it can be looked at, not clicked. */
export function WidgetPreview({ meta, sizeId, config, metrics, maxWidth, maxHeight }: WidgetPreviewProps) {
  const size = meta.sizes.find((s) => s.id === sizeId) ?? meta.sizes[0];
  if (!size) return null;
  const width = spanPx(size.w, metrics);
  const height = spanPx(size.h, metrics);
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return (
    <div className="widget-preview" style={{ width: width * scale, height: height * scale }} aria-hidden="true">
      <div
        className="widget-preview__stage"
        style={{ width, height, transform: `scale(${scale})`, "--w": size.w, "--h": size.h } as CSSProperties}
        inert
      >
        <WidgetView id={meta.id} size={size.id} config={config} />
      </div>
    </div>
  );
}
