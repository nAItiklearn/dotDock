import { describe, expect, it } from "vitest";
import { filterApps, fold, isNavKey, matchScore, moveAcrossSections, moveInGrid, nextQuery } from "./nav";

describe("moveInGrid", () => {
  // 3 columns, 8 items:
  // 0 1 2
  // 3 4 5
  // 6 7
  it("steps left and right through the rows and stops at the ends", () => {
    expect(moveInGrid(2, "ArrowRight", 3, 8)).toBe(3);
    expect(moveInGrid(3, "ArrowLeft", 3, 8)).toBe(2);
    expect(moveInGrid(0, "ArrowLeft", 3, 8)).toBe(0);
    expect(moveInGrid(7, "ArrowRight", 3, 8)).toBe(7);
  });
  it("keeps the column on up and down", () => {
    expect(moveInGrid(1, "ArrowDown", 3, 8)).toBe(4);
    expect(moveInGrid(4, "ArrowUp", 3, 8)).toBe(1);
    expect(moveInGrid(1, "ArrowUp", 3, 8)).toBe(1);
  });
  it("reaches the short last row by its last item and stays on it", () => {
    expect(moveInGrid(5, "ArrowDown", 3, 8)).toBe(7);
    expect(moveInGrid(7, "ArrowDown", 3, 8)).toBe(7);
  });
  it("jumps to the first and last item and copes with an empty grid", () => {
    expect(moveInGrid(4, "Home", 3, 8)).toBe(0);
    expect(moveInGrid(4, "End", 3, 8)).toBe(7);
    expect(moveInGrid(0, "ArrowDown", 3, 0)).toBe(-1);
  });
  it("recognises navigation keys", () => {
    expect(isNavKey("ArrowUp")).toBe(true);
    expect(isNavKey("a")).toBe(false);
  });
});

describe("moveAcrossSections", () => {
  const counts = [5, 0, 4]; // the empty section is skipped
  it("carries the column from one section into the next on down and back on up", () => {
    expect(moveAcrossSections(counts, { section: 0, index: 4 }, "ArrowDown", 3)).toEqual({ section: 2, index: 1 });
    expect(moveAcrossSections(counts, { section: 2, index: 1 }, "ArrowUp", 3)).toEqual({ section: 0, index: 4 });
  });
  it("clamps to a short row in the target section", () => {
    expect(moveAcrossSections([3, 2], { section: 0, index: 2 }, "ArrowDown", 3)).toEqual({ section: 1, index: 1 });
    expect(moveAcrossSections([2, 6], { section: 1, index: 1 }, "ArrowUp", 3)).toEqual({ section: 0, index: 1 });
  });
  it("continues left and right into neighbouring sections", () => {
    expect(moveAcrossSections([2, 3], { section: 0, index: 1 }, "ArrowRight", 3)).toEqual({ section: 1, index: 0 });
    expect(moveAcrossSections([2, 3], { section: 1, index: 0 }, "ArrowLeft", 3)).toEqual({ section: 0, index: 1 });
  });
  it("stops at the first and last section", () => {
    expect(moveAcrossSections([2, 3], { section: 0, index: 0 }, "ArrowUp", 3)).toEqual({ section: 0, index: 0 });
    expect(moveAcrossSections([2, 3], { section: 1, index: 2 }, "ArrowDown", 3)).toEqual({ section: 1, index: 2 });
  });
  it("jumps to the very first and very last app", () => {
    expect(moveAcrossSections(counts, { section: 2, index: 2 }, "Home", 3)).toEqual({ section: 0, index: 0 });
    expect(moveAcrossSections(counts, { section: 0, index: 0 }, "End", 3)).toEqual({ section: 2, index: 3 });
  });
  it("leaves the position alone when everything is empty", () => {
    expect(moveAcrossSections([0, 0], { section: 0, index: 0 }, "ArrowDown", 3)).toEqual({ section: 0, index: 0 });
  });
});

describe("matching", () => {
  const apps = [
    { name: "Visual Studio Code", publisher: "Contoso Tools" },
    { name: "Café Notes", publisher: null },
    { name: "Notepad", publisher: "Fabrikam" },
    { name: "Terminal", publisher: "Fabrikam" },
  ];
  it("folds case and accents", () => {
    expect(fold("Café")).toBe("cafe");
  });
  it("ranks prefix over word start over substring over publisher", () => {
    expect(matchScore(apps[2]!, "note")).toBeGreaterThan(matchScore(apps[1]!, "note"));
    expect(matchScore(apps[1]!, "note")).toBeGreaterThan(matchScore({ name: "Footnotes", publisher: null }, "note"));
    expect(matchScore(apps[3]!, "fabri")).toBeGreaterThan(0);
    expect(matchScore(apps[3]!, "fabri")).toBeLessThan(matchScore({ name: "Fabric", publisher: null }, "fabri"));
  });
  it("finds apps by their initials", () => {
    expect(matchScore(apps[0]!, "vsc")).toBeGreaterThan(0);
    expect(matchScore(apps[0]!, "zzz")).toBe(0);
  });
  it("matches a category name when given", () => {
    expect(matchScore(apps[3]!, "develop", "Development")).toBeGreaterThan(0);
  });
  it("keeps everything for an empty query and sorts the rest best first", () => {
    expect(filterApps(apps, "  ")).toHaveLength(4);
    expect(filterApps(apps, "note").map((a) => a.name)).toEqual(["Notepad", "Café Notes"]);
    expect(filterApps(apps, "q")).toEqual([]);
  });
});

describe("nextQuery", () => {
  const key = (k: string, extra: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({ key: k, ctrlKey: false, altKey: false, metaKey: false, ...extra });
  it("appends characters, deletes with Backspace and ignores shortcuts and named keys", () => {
    expect(nextQuery("ab", key("c"))).toBe("abc");
    expect(nextQuery("ab", key("Backspace"))).toBe("a");
    expect(nextQuery("", key("Backspace"))).toBe("");
    expect(nextQuery("ab", key("c", { ctrlKey: true }))).toBeNull();
    expect(nextQuery("ab", key("ArrowDown"))).toBeNull();
    expect(nextQuery("ab", key("Enter"))).toBeNull();
  });
  it("accepts spaces only inside a query", () => {
    expect(nextQuery("", key(" "))).toBeNull();
    expect(nextQuery("vis", key(" "))).toBe("vis ");
  });
});
