import type { WidgetCatalog } from "../lib/model/types";
import { WIDGETS, getWidget } from "../widgets/registry";

/**
 * Widgets below the 4.5 visual-rubric bar (owner rule) are not offered until they pass.
 * Existing placements still render; they just cannot be added. Remove an id once it scores >= 4.5.
 */
const BELOW_BAR: ReadonlySet<string> = new Set(["weather", "quote", "calendar", "notes", "todo"]);
const OFFERED = WIDGETS.filter((w) => !BELOW_BAR.has(w.id));

/**
 * The widget registry seen through the layout engine's narrow `WidgetCatalog` interface. This is the one place
 * the overlay and Settings learn which widgets exist; rendering goes through `<WidgetView>`.
 */
export const widgetCatalog: WidgetCatalog = {
  list: () => OFFERED,
  get: getWidget,
};
