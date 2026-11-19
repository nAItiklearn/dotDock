/**
 * A halftone sphere drawn in code: dot size follows a simple diffuse light from the upper left.
 * Served as a static SVG that CSS uses as a mask, so the page's text colour paints it and it
 * changes with the theme. Original geometry, no source image.
 */
import type { APIRoute } from "astro";

const CELLS = 22;
const LIGHT = (() => {
  const v = [-0.55, -0.65, 0.55] as const;
  const len = Math.hypot(...v);
  return v.map((n) => n / len) as [number, number, number];
})();

function build(): string {
  const radius = CELLS / 2;
  const dots: string[] = [];
  for (let row = 0; row < CELLS; row++) {
    for (let col = 0; col < CELLS; col++) {
      const x = (col + 0.5 - radius) / radius;
      const y = (row + 0.5 - radius) / radius;
      const flat = x * x + y * y;
      if (flat > 1) continue;
      const z = Math.sqrt(1 - flat);
      const lit = Math.max(0, x * LIGHT[0] + y * LIGHT[1] + z * LIGHT[2]);
      const r = 0.07 + 0.43 * lit ** 0.85;
      if (r < 0.1) continue;
      const cy = (row + 0.5).toFixed(2);
      const d = r.toFixed(2);
      dots.push(`M${(col + 0.5 - r).toFixed(2)} ${cy}a${d} ${d} 0 1 0 ${(2 * r).toFixed(2)} 0a${d} ${d} 0 1 0 ${(-2 * r).toFixed(2)} 0Z`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CELLS} ${CELLS}"><path d="${dots.join("")}"/></svg>`;
}

export const GET: APIRoute = () =>
  new Response(build(), { headers: { "Content-Type": "image/svg+xml" } });
