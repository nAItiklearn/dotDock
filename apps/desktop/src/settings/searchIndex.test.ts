import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PAGES } from "./pageMeta";
import { SEARCH_ENTRIES, searchSettings } from "./searchIndex";

const settingsDir = dirname(fileURLToPath(import.meta.url));
const sourcesIn = (dir: string): string[] =>
  readdirSync(join(settingsDir, dir))
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => readFileSync(join(settingsDir, dir, f), "utf8"));
// Row ids live in the pages and in the sections they embed.
const pageSources = [...sourcesIn("pages"), ...sourcesIn("ui")].join("\n");

describe("search index", () => {
  it("has unique ids", () => {
    const ids = SEARCH_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("points only at pages that exist, and every page can be found", () => {
    const pages = new Set(PAGES.map((p) => p.id));
    for (const entry of SEARCH_ENTRIES) expect(pages.has(entry.page), entry.id).toBe(true);
    for (const page of PAGES) expect(SEARCH_ENTRIES.some((e) => e.page === page.id), page.id).toBe(true);
  });

  it("only lists settings that are actually on their page, so search never leads nowhere", () => {
    for (const entry of SEARCH_ENTRIES) {
      const dynamic = entry.id.startsWith("shortcut-");
      const present = dynamic ? pageSources.includes("`shortcut-${") : pageSources.includes(`"${entry.id}"`);
      expect(present, `${entry.page}/${entry.id} is not rendered by its page`).toBe(true);
    }
  });
});

describe("searchSettings", () => {
  it("returns nothing for a blank query", () => {
    expect(searchSettings("")).toEqual([]);
    expect(searchSettings("   ")).toEqual([]);
  });

  it("finds by title, keyword and page name", () => {
    expect(searchSettings("corner")[0]?.id).toBe("radius");
    expect(searchSettings("fullscreen").map((h) => h.id)).toContain("pause-rules");
    expect(searchSettings("shortcuts").map((h) => h.page)).toContain("shortcuts");
  });

  it("is case-insensitive and needs every word to match", () => {
    expect(searchSettings("DARK schedule").map((h) => h.id)).toContain("theme-switch");
    expect(searchSettings("dark teapot")).toEqual([]);
  });

  it("ranks title matches above keyword matches", () => {
    const hits = searchSettings("theme");
    expect(hits[0]?.id).toBe("theme");
  });

  it("carries the page title for display", () => {
    expect(searchSettings("launch")[0]).toMatchObject({ id: "launch", pageTitle: "Startup & Windows" });
  });
});
