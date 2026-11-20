import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Owner rule: no gradients anywhere, the test harness included. Every dock style sheet is read and checked. */
const dockDir = dirname(fileURLToPath(import.meta.url));

function styleSheets(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return styleSheets(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

describe("the dock's styles", () => {
  it("use no gradient of any kind", () => {
    const sheets = styleSheets(resolve(dockDir));
    expect(sheets.length).toBeGreaterThan(5);
    for (const sheet of sheets) expect(readFileSync(sheet, "utf8"), sheet).not.toMatch(/gradient\(/i);
  });
});
