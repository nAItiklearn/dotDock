import { appsInCategory, categoriesWithApps } from "./model";
import { filterApps, matchScore } from "./nav";
import type { Category, DockApp } from "./protocol";
import { categoryLabel } from "./strings";

export interface LibrarySection {
  readonly category: Category;
  readonly label: string;
  readonly apps: readonly DockApp[];
}

/** Where apps whose category was deleted end up. */
const ORPHAN_CATEGORY: Category = { id: "other", name: null, tone: "neutral", order: Number.MAX_SAFE_INTEGER };

/**
 * The App Library's sections: every category that has apps, in the user's order, each with the apps that match
 * the query. While searching, the section holding the best match comes first and empty sections disappear.
 */
export function librarySections(categories: readonly Category[], apps: readonly DockApp[], query: string): LibrarySection[] {
  const known = new Set(categories.map((c) => c.id));
  const orphans = apps.filter((a) => !known.has(a.category));
  const lists: { category: Category; inCategory: DockApp[] }[] = categoriesWithApps(categories, apps).map((category) => ({
    category,
    inCategory: appsInCategory(apps, category.id),
  }));
  if (orphans.length > 0) {
    const home = lists.find((l) => l.category.id === ORPHAN_CATEGORY.id);
    if (home) home.inCategory = [...home.inCategory, ...orphans];
    else lists.push({ category: ORPHAN_CATEGORY, inCategory: orphans });
  }

  const sections = lists
    .map(({ category, inCategory }) => {
      const label = categoryLabel(category);
      const matched = filterApps(inCategory, query, label);
      const first = matched[0];
      return { category, label, apps: matched, best: first ? matchScore(first, query, label) : 0 };
    })
    .filter((s) => s.apps.length > 0);
  if (query.trim() !== "") sections.sort((a, b) => b.best - a.best);
  return sections.map(({ category, label, apps: found }) => ({ category, label, apps: found }));
}
