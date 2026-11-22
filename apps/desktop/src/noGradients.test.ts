import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Owner rule: no gradients anywhere in the app. Every style sheet and source file, of every window, is checked. */
const srcDir = dirname(fileURLToPath(import.meta.url));

function filesIn(dir: string, ends: readonly string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesIn(path, ends);
    return ends.some((end) => entry.name.endsWith(end)) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** CSS gradients, SVG gradients and canvas gradients. */
const GRADIENT = /gradient\(|linearGradient|radialGradient|createLinearGradient|createRadialGradient|createConicGradient/i;

describe("the app's styles and sources", () => {
  it("use no gradient of any kind, in CSS, TS, TSX or SVG", () => {
    const files = filesIn(srcDir, [".css", ".ts", ".tsx", ".svg"]);
    expect(files.some((f) => f.endsWith(".css"))).toBe(true);
    expect(files.some((f) => f.endsWith(".tsx"))).toBe(true);
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toMatch(GRADIENT);
  });
});
