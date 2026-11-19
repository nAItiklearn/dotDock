import { useLayoutEffect, useRef } from "react";
import { applyTheme } from "../../design-system/themes";
import { WidgetPreview } from "../../overlay/WidgetPreview";
import { widgetCatalog } from "../../overlay/catalog";
import type { GridMetrics } from "../../lib/layout/grid";
import { toRuntimeTheme, type ThemeDoc } from "../../lib/theme/schema";

const PREVIEW_WIDGETS = [
  { kind: "clock", size: "s", max: 268 },
  { kind: "date-circle", size: "m", max: 126 },
  { kind: "battery-ring", size: "m", max: 126 },
] as const;

/**
 * The theme as it will look on the desktop: real widgets on the theme's background, with the theme's
 * variables scoped to this box. Edits show here the instant they are made.
 */
export function ThemePreview({ theme, metrics }: { readonly theme: ThemeDoc; readonly metrics: GridMetrics }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (box.current) applyTheme(toRuntimeTheme(theme), box.current);
  }, [theme]);
  return (
    <div className="theme-preview" ref={box} role="img" aria-label={`Preview of the ${theme.name} theme`}>
      {PREVIEW_WIDGETS.map(({ kind, size, max }) => {
        const meta = widgetCatalog.get(kind);
        return meta ? (
          <WidgetPreview key={kind} meta={meta} sizeId={size} metrics={metrics} maxWidth={max} maxHeight={max} />
        ) : null;
      })}
    </div>
  );
}
