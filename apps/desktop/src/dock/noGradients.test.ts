import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Owner rule: no gradients anywhere, the test harness included. Every dock style sheet and source file is checked. */
const dockDir = dirname(fileURLToPath(import.meta.url));

function filesIn(dir: string, ends: readonly string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesIn(path, ends);
    return ends.some((end) => entry.name.endsWith(end)) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

/** CSS gradients, SVG gradients and canvas gradients. */
const GRADIENT = /gradient\(|linearGradient|radialGradient|createLinearGradient|createRadialGradient|createConicGradient/i;

describe("the dock's styles", () => {
  it("use no gradient of any kind", () => {
    const sheets = filesIn(resolve(dockDir), [".css"]);
    expect(sheets.length).toBeGreaterThan(5);
    for (const sheet of sheets) expect(readFileSync(sheet, "utf8"), sheet).not.toMatch(GRADIENT);
  });

  it("and no source file draws one, in SVG or on a canvas", () => {
    const sources = filesIn(resolve(dockDir), [".ts", ".tsx", ".svg"]);
    expect(sources.length).toBeGreaterThan(20);
    for (const source of sources) expect(readFileSync(source, "utf8"), source).not.toMatch(GRADIENT);
  });
});
