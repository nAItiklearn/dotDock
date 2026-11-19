import type { WidgetCatalog } from "../lib/model/types";
import { WIDGETS, getWidget } from "../widgets/registry";
import type { SizeSpec } from "../widgets/sizes";

/**
 * The widget registry seen through the layout engine's narrow `WidgetCatalog` interface. This is the one place
 * the overlay and Settings learn which widgets exist; rendering goes through `<WidgetView>`.
 */
export const widgetCatalog: WidgetCatalog = {
  list: () => WIDGETS,
  get: getWidget,
};

/** Sizes smallest first, for pickers; the registry lists the default size first instead. */
export function sizesByArea(sizes: readonly SizeSpec[]): readonly SizeSpec[] {
  return [...sizes].sort((a, b) => a.w * a.h - b.w * b.h);
}
