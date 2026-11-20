import type { DockApp } from "./protocol";

export type NavKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End";

export const isNavKey = (key: string): key is NavKey =>
  key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight" || key === "Home" || key === "End";

/**
 * Moves the selection in a grid that fills row by row. Left and right step through items and continue onto
 * the next or previous row; up and down keep the column, and a short last row is reached by its last item.
 */
export function moveInGrid(index: number, key: NavKey, cols: number, count: number): number {
  if (count <= 0) return -1;
  const last = count - 1;
  const from = Math.min(Math.max(index, 0), last);
  switch (key) {
    case "ArrowLeft":
      return Math.max(0, from - 1);
    case "ArrowRight":
      return Math.min(last, from + 1);
    case "Home":
      return 0;
    case "End":
      return last;
    case "ArrowUp":
      return from - cols >= 0 ? from - cols : from;
    case "ArrowDown": {
      if (from + cols <= last) return from + cols;
      const onLastRow = Math.floor(from / cols) === Math.floor(last / cols);
      return onLastRow ? from : last;
    }
  }
}

export interface GridPosition {
  readonly section: number;
  readonly index: number;
}

/**
 * Selection across several grids stacked top to bottom (the App Library's categories). Up and down keep the
 * column when they cross from one section into the next.
 */
export function moveAcrossSections(counts: readonly number[], pos: GridPosition, key: NavKey, cols: number): GridPosition {
  const sections = counts.map((count, section) => ({ count, section })).filter((s) => s.count > 0);
  if (sections.length === 0) return pos;
  const at = sections.findIndex((s) => s.section === pos.section);
  const here = sections[at] ?? sections[0];
  if (!here) return pos;
  const index = Math.min(pos.index, here.count - 1);
  const column = index % cols;

  if (key === "Home") return { section: sections[0]?.section ?? pos.section, index: 0 };
  if (key === "End") {
    const tail = sections[sections.length - 1] ?? here;
    return { section: tail.section, index: tail.count - 1 };
  }
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const moved = moveInGrid(index, key, cols, here.count);
    if (moved !== index) return { section: here.section, index: moved };
    const neighbour = sections[at + (key === "ArrowRight" ? 1 : -1)];
    if (!neighbour) return { section: here.section, index };
    return { section: neighbour.section, index: key === "ArrowRight" ? 0 : neighbour.count - 1 };
  }

  const moved = moveInGrid(index, key, cols, here.count);
  if (moved !== index) return { section: here.section, index: moved };
  if (key === "ArrowDown") {
    const next = sections[at + 1];
    if (!next) return { section: here.section, index };
    return { section: next.section, index: Math.min(column, next.count - 1) };
  }
  const previous = sections[at - 1];
  if (!previous) return { section: here.section, index };
  const lastRowStart = Math.floor((previous.count - 1) / cols) * cols;
  return { section: previous.section, index: Math.min(lastRowStart + column, previous.count - 1) };
}

const COMBINING_MARKS = /\p{M}/gu;

/** Lower case with accents removed, so "Cafe" finds "Café". */
export function fold(text: string): string {
  return text.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
}

const SCORE = { exact: 100, prefix: 80, wordPrefix: 60, substring: 40, publisher: 25, category: 20, fuzzy: 10 } as const;

/** Whether the letters of `needle` appear in `haystack` in order, as in "vsc" for "Visual Studio Code". */
function isSubsequence(needle: string, haystack: string): boolean {
  let at = 0;
  for (const ch of haystack) {
    if (ch === needle[at]) at++;
    if (at === needle.length) return true;
  }
  return needle.length === 0;
}

const WORD_BREAK = /[\s\-_.]+/u;

/** How well an app answers a query: 0 for no match. Names beat publishers, prefixes beat substrings. */
export function matchScore(app: Pick<DockApp, "name" | "publisher">, query: string, categoryName?: string): number {
  const q = fold(query.trim());
  if (q === "") return 1;
  const name = fold(app.name);
  if (name === q) return SCORE.exact;
  if (name.startsWith(q)) return SCORE.prefix;
  if (name.split(WORD_BREAK).some((word) => word.startsWith(q))) return SCORE.wordPrefix;
  if (name.includes(q)) return SCORE.substring;
  if (app.publisher !== null && fold(app.publisher).includes(q)) return SCORE.publisher;
  if (categoryName !== undefined && fold(categoryName).includes(q)) return SCORE.category;
  if (q.length >= 2 && isSubsequence(q.replaceAll(" ", ""), name.replaceAll(" ", ""))) return SCORE.fuzzy;
  return 0;
}

/** Apps that match the query, best first; ties keep the name order of the input. */
export function filterApps<T extends Pick<DockApp, "name" | "publisher">>(apps: readonly T[], query: string, categoryName?: string): T[] {
  if (query.trim() === "") return [...apps];
  return apps
    .map((app, order) => ({ app, order, score: matchScore(app, query, categoryName) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((r) => r.app);
}

export interface KeyLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

/** The query after a key press: typed characters append, Backspace removes one, anything else is not typing (null). */
export function nextQuery(query: string, event: KeyLike): string | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  if (event.key === "Backspace") return query.slice(0, -1);
  return [...event.key].length === 1 && event.key !== " " ? query + event.key : event.key === " " && query !== "" ? `${query} ` : null;
}
