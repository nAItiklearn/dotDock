import type { BarLayout } from "./Bar";
import type { GlassShape } from "./protocol";
import { snapRect } from "./regions";
import type { DockThemeId } from "./theme";

export interface GlassRequest {
  readonly shapes: readonly GlassShape[];
  readonly dark: boolean;
}

/**
 * Corner radius of the glass plate as a share of the bar's thickness: the `--plate-round` of the glass theme in
 * dock.css (a test keeps the two equal), so the acrylic is cut to exactly the drawn plate.
 */
export const GLASS_PLATE_ROUND = 0.3;

/**
 * Where the core's acrylic plate goes. Only the `glass` theme asks for it (glass-lite and the opaque themes draw
 * their own fill), and only while the bar is on screen. The plate is a rounded rectangle with the theme's corners.
 */
export function glassRequest(layout: BarLayout | null, theme: DockThemeId, hidden: boolean, dark: boolean): GlassRequest {
  if (!layout || hidden || theme !== "glass") return { shapes: [], dark };
  const bar = snapRect(layout.bar);
  return { shapes: [{ ...bar, radius: Math.round(Math.min(bar.w, bar.h) * GLASS_PLATE_ROUND) }], dark };
}

export const sameGlass = (a: GlassRequest, b: GlassRequest): boolean =>
  a.dark === b.dark &&
  a.shapes.length === b.shapes.length &&
  a.shapes.every((s, i) => {
    const o = b.shapes[i];
    return o !== undefined && s.x === o.x && s.y === o.y && s.w === o.w && s.h === o.h && s.radius === o.radius;
  });
