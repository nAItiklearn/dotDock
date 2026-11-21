import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Unit tests import no CSS, so a stylesheet with an unclosed block (a merge seam, a slip) would only
 * show at build or in the window. This catches it here: every block in every stylesheet closes.
 */
const SRC = resolve(__dirname, "../..");

function stylesheets(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return stylesheets(path);
    return name.endsWith(".css") ? [path] : [];
  });
}

/** The first problem with the braces of a stylesheet, or null. Comments and strings are skipped. */
function braceProblem(css: string): string | null {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:[^"\\n]|\.)*"|'(?:[^'\\n]|\.)*'/g, '""');
  let depth = 0;
  let line = 1;
  let opened: number[] = [];
  for (const ch of bare) {
    if (ch === "\n") line += 1;
    if (ch === "{") {
      depth += 1;
      opened = [...opened, line];
    } else if (ch === "}") {
      depth -= 1;
      opened = opened.slice(0, -1);
      if (depth < 0) return `a } with no block to close, line ${line}`;
    }
  }
  return depth === 0 ? null : `a block opened on line ${opened[opened.length - 1] ?? 0} never closes`;
}

describe("stylesheets", () => {
  it("find the problems they are meant to", () => {
    expect(braceProblem("a { b: c; }\n/* { */ d { e: \"}\"; }")).toBeNull();
    expect(braceProblem("a {\n  b: c;\n\nd { e: f; }")).toBe("a block opened on line 1 never closes");
    expect(braceProblem("a { } }")).toBe("a } with no block to close, line 1");
  });

  it("all close every block they open", () => {
    const problems = stylesheets(SRC).flatMap((file) => {
      const problem = braceProblem(readFileSync(file, "utf8"));
      return problem ? [`${relative(SRC, file)}: ${problem}`] : [];
    });
    expect(problems).toEqual([]);
  });
});
