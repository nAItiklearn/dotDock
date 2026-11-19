import { describe, expect, it } from "vitest";
import { widgetCatalog } from "../../overlay/catalog";
import { defaultLayoutDoc } from "../model/defaults";
import type { CollisionMode, Placement } from "../model/types";
import { rectsOverlap } from "./grid";
import { addWidget, duplicateWidget, moveTo, normalizePlacements, rectOf, removeWidget, resizeTo, type LayoutContext } from "./ops";

/** Small deterministic generator so a failure can be reproduced from its seed. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Everything that must hold after any edit, as a list of violations so one failing step explains itself. */
function violations(ps: readonly Placement[], ctx: LayoutContext, expectedIds: ReadonlySet<string>): string[] {
  const found: string[] = [];
  const rects = ps.map((p) => rectOf(ctx.catalog, p));
  const idList = ps.map((p) => p.id);
  if (new Set(idList).size !== ps.length) found.push("duplicate ids");
  if (idList.length !== expectedIds.size || idList.some((id) => !expectedIds.has(id))) found.push("a widget was lost or invented");
  rects.forEach((r, i) => {
    if (r.x < 0 || r.y < 0 || r.x + r.w > ctx.bounds.cols || r.y + r.h > ctx.bounds.rows) found.push(`${ps[i]?.id} is outside the grid`);
    rects.forEach((o, j) => {
      if (i < j && rectsOverlap(r, o)) found.push(`${ps[i]?.id} overlaps ${ps[j]?.id}`);
    });
  });
  return found;
}

describe.each<CollisionMode>(["push", "swap"])("random editing sessions (%s)", (collision) => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`never lose, duplicate, overlap or push off-grid a widget (seed ${seed})`, () => {
      const random = mulberry32(seed * 7919);
      const ctx: LayoutContext = { bounds: { cols: 14, rows: 8 }, collision, catalog: widgetCatalog };
      let ps: readonly Placement[] = normalizePlacements(defaultLayoutDoc("work").monitors["primary"]?.placements ?? [], ctx);
      const ids = new Set(ps.map((p) => p.id));
      const kinds = widgetCatalog.list().map((m) => m.id);
      const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;

      for (let step = 0; step < 400; step++) {
        const roll = random();
        const id = pick([...ids]);
        let next: readonly Placement[] | null = null;
        if (roll < 0.6) {
          next = moveTo(ps, id, { x: Math.floor(random() * 18) - 2, y: Math.floor(random() * 10) - 2 }, ctx);
        } else if (roll < 0.75) {
          const kind = ps.find((p) => p.id === id)?.widget ?? "clock";
          const sizes = widgetCatalog.get(kind)?.sizes ?? [];
          next = sizes.length > 0 ? resizeTo(ps, id, pick(sizes).id, ctx) : null;
        } else if (roll < 0.85 && ids.size < 14) {
          const added = addWidget(ps, pick(kinds), undefined, ctx);
          if (added) {
            ids.add(added.id);
            next = added.placements;
          }
        } else if (roll < 0.93 && ids.size < 14) {
          const copy = duplicateWidget(ps, id, ctx);
          if (copy) {
            ids.add(copy.id);
            next = copy.placements;
          }
        } else if (ids.size > 2) {
          ids.delete(id);
          next = removeWidget(ps, id);
        }
        if (next) ps = next;
        const broken = violations(ps, ctx, ids);
        if (broken.length > 0) expect(broken, `seed ${seed} step ${step}`).toEqual([]);
      }
    });
  }
});
