import type { BarLayout } from "./Bar";
import type { GlassShape } from "./protocol";
import { snapRect } from "./regions";
import type { DockThemeId } from "./theme";

export interface GlassRequest {
  readonly shapes: readonly GlassShape[];
  readonly dark: boolean;
}

/**
 * Where the core's acrylic plate goes. Only the `glass` theme asks for it (glass-lite and the opaque themes draw
 * their own fill), and only while the bar is on screen. The bar is a pill: its corner radius is half its thickness.
 */
export function glassRequest(layout: BarLayout | null, theme: DockThemeId, hidden: boolean, dark: boolean): GlassRequest {
  if (!layout || hidden || theme !== "glass") return { shapes: [], dark };
  const bar = snapRect(layout.bar);
  return { shapes: [{ ...bar, radius: Math.min(bar.w, bar.h) / 2 }], dark };
}

export const sameGlass = (a: GlassRequest, b: GlassRequest): boolean =>
  a.dark === b.dark &&
  a.shapes.length === b.shapes.length &&
  a.shapes.every((s, i) => {
    const o = b.shapes[i];
    return o !== undefined && s.x === o.x && s.y === o.y && s.w === o.w && s.h === o.h && s.radius === o.radius;
  });
