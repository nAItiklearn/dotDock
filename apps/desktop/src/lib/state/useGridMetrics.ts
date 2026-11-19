import { useMemo, useState } from "react";
import type { GridMetrics } from "../layout/grid";
import { effectiveEdgeMargin } from "../theme/appearance";
import { getApp } from "./app";
import { useSettingsStore } from "./hooks";

/** Falls back to the stylesheet's own value if the token is missing; keeps JS and CSS from drifting apart. */
const FALLBACK_CELL_PX = 76;

function readCellPx(): number {
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cell"));
  return Number.isFinite(value) && value > 0 ? value : FALLBACK_CELL_PX;
}

/** Pixel geometry of the cell grid: the --cell token plus the user's spacing and edge margin for this display. */
export function useGridMetrics(): GridMetrics {
  const gap = useSettingsStore((s) => s.settings.layout.gap);
  const edge = useSettingsStore((s) => effectiveEdgeMargin(s.settings, getApp().monitorId));
  const [cell] = useState(readCellPx);
  return useMemo(() => ({ cell, gap, edge }), [cell, gap, edge]);
}
