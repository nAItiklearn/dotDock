import { useLayoutEffect, useRef } from "react";
import { applyTheme } from "../../design-system/themes";
import { WidgetPreview } from "../../overlay/WidgetPreview";
import { widgetCatalog } from "../../overlay/catalog";
import type { GridMetrics } from "../../lib/layout/grid";
import { toRuntimeTheme, type ThemeDoc } from "../../lib/theme/schema";

const PREVIEW_WIDGETS = [
  { id: "clock", size: "m", max: 268 },
  { id: "date", size: "s", max: 126 },
  { id: "battery", size: "m", max: 126 },
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
      {PREVIEW_WIDGETS.map(({ id, size, max }) => {
        const meta = widgetCatalog.get(id);
        return meta ? (
          <WidgetPreview key={id} meta={meta} sizeId={size} metrics={metrics} maxWidth={max} maxHeight={max} />
        ) : null;
      })}
    </div>
  );
}
