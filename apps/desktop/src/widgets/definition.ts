import type { ComponentType } from "react";
import type { ProviderName } from "../providers/types";
import type { ConfigSchema } from "./configSchema";
import type { SizeId, SizeSpec } from "./sizes";

export type WidgetCategory = "time" | "system" | "media" | "productivity" | "info";

export interface WidgetProps<C> {
  readonly size: SizeId;
  readonly config: C;
}

/**
 * Everything the host needs to list, place, configure and render a widget.
 * Built-ins and any future third-party widget share this shape.
 */
export interface WidgetDefinition<C> {
  readonly id: string;
  readonly name: string;
  /** One line for the widget gallery. */
  readonly description: string;
  readonly category: WidgetCategory;
  /** Sizes in grid cells. The first is the default. Each has its own designed layout. */
  readonly sizes: readonly SizeSpec[];
  /** Providers the widget reads, so the host only starts the ones in use. */
  readonly providers: readonly ProviderName[];
  readonly defaultConfig: C;
  readonly settingsSchema: ConfigSchema;
  readonly component: ComponentType<WidgetProps<C>>;
}

/** Keeps each widget's config type checked against its definition. */
export function defineWidget<C>(definition: WidgetDefinition<C>): WidgetDefinition<C> {
  return definition;
}
