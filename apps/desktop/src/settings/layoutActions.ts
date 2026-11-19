import { boundsFor, type GridMetrics } from "../lib/layout/grid";
import { addWidget, normalizePlacements, type LayoutContext } from "../lib/layout/ops";
import type { AppContext } from "../lib/state/app";
import { monitorLayoutOf } from "../lib/state/layoutRepo";
import type { LayoutDoc, MonitorId, Placement } from "../lib/model/types";

export type AddOutcome =
  | { readonly ok: true; readonly placementId: string; readonly doc: LayoutDoc }
  | { readonly ok: false; readonly reason: "no-room" | "unknown-widget" };

/** Grid extent of the screen this window is on: the best guess for a layout we cannot measure directly. */
export function guessBounds(metrics: GridMetrics) {
  return boundsFor(window.screen.width, window.screen.height, metrics);
}

class NoRoom extends Error {}

/** Adds a widget to one display of a profile without the overlay being involved. */
export async function addWidgetToProfile(
  app: AppContext,
  options: { profileId: string; monitorId: MonitorId; isPrimary: boolean; widget: string; sizeId: string | undefined; metrics: GridMetrics },
): Promise<AddOutcome> {
  const collision = app.settings.getState().settings.layout.collision;
  const ctx: LayoutContext = { bounds: guessBounds(options.metrics), collision, catalog: app.catalog };
  if (!app.catalog.get(options.widget)) return { ok: false, reason: "unknown-widget" };
  let placementId = "";
  try {
    const doc = await app.repo.update(options.profileId, (current) => {
      const existing = normalizePlacements(monitorLayoutOf(current, options.monitorId, options.isPrimary).placements, ctx);
      const added = addWidget(existing, options.widget, options.sizeId, ctx);
      if (!added) throw new NoRoom();
      placementId = added.id;
      return { ...current, monitors: { ...current.monitors, [options.monitorId]: { placements: added.placements } } };
    });
    return { ok: true, placementId, doc };
  } catch (error) {
    if (error instanceof NoRoom) return { ok: false, reason: "no-room" };
    throw error;
  }
}

/** Removes one widget from a display of a profile. Returns what it removed, so the removal can be undone. */
export async function removeWidgetFromProfile(
  app: AppContext,
  options: { profileId: string; monitorId: MonitorId; isPrimary: boolean; placementId: string },
): Promise<Placement | null> {
  let removed: Placement | null = null;
  await app.repo.update(options.profileId, (current) => {
    const existing = monitorLayoutOf(current, options.monitorId, options.isPrimary).placements;
    removed = existing.find((p) => p.id === options.placementId) ?? null;
    if (!removed) return current;
    return {
      ...current,
      monitors: { ...current.monitors, [options.monitorId]: { placements: existing.filter((p) => p.id !== options.placementId) } },
    };
  });
  return removed;
}

/** Puts a removed widget back where it was. If something took the spot meanwhile, the overlay settles the pair apart when it draws. */
export async function restoreWidgetToProfile(
  app: AppContext,
  options: { profileId: string; monitorId: MonitorId; isPrimary: boolean; placement: Placement },
): Promise<void> {
  await app.repo.update(options.profileId, (current) => {
    const existing = monitorLayoutOf(current, options.monitorId, options.isPrimary).placements;
    if (existing.some((p) => p.id === options.placement.id)) return current;
    return {
      ...current,
      monitors: { ...current.monitors, [options.monitorId]: { placements: [...existing, options.placement] } },
    };
  });
}

export async function clearDisplayLayout(
  app: AppContext,
  options: { profileId: string; monitorId: MonitorId },
): Promise<readonly Placement[]> {
  let previous: readonly Placement[] = [];
  await app.repo.update(options.profileId, (current) => {
    previous = current.monitors[options.monitorId]?.placements ?? [];
    return { ...current, monitors: { ...current.monitors, [options.monitorId]: { placements: [] } } };
  });
  return previous;
}
