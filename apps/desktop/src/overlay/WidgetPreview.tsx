import type { CSSProperties } from "react";
import { spanPx, type GridMetrics } from "../lib/layout/grid";
import type { JsonObject } from "../lib/model/json";
import type { WidgetMeta } from "../lib/model/types";
import { renderWidget } from "./catalog";
import "./WidgetPreview.css";

export interface WidgetPreviewProps {
  readonly meta: WidgetMeta;
  readonly sizeId: string;
  readonly config?: JsonObject;
  readonly metrics: GridMetrics;
  /** The preview shrinks to fit this box but is never enlarged past real size. */
  readonly maxWidth: number;
  readonly maxHeight: number;
}

/** The real widget, live, scaled down into a card. Inert: it can be looked at, not clicked. */
export function WidgetPreview({ meta, sizeId, config, metrics, maxWidth, maxHeight }: WidgetPreviewProps) {
  const size = meta.sizes.find((s) => s.id === sizeId) ?? meta.sizes.find((s) => s.id === meta.defaultSize) ?? meta.sizes[0];
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
        {renderWidget({ kind: meta.kind, size: size.id, config: config ?? meta.defaultConfig })}
      </div>
    </div>
  );
}
