import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Widget colours follow the theme, and the theme follows the wallpaper. That holds only while every
 * colour on the home screen comes from a theme token: one literal colour would stay put when the
 * wallpaper changes and stand out on the next one.
 */
const SRC = fileURLToPath(new URL("..", import.meta.url));
const HOME_SCREEN_DIRS = ["widgets", "overlay"];
const LITERAL_COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:white|black|red|green|blue|gray|grey|silver)\b(?!-)/i;

function stylesheets(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return stylesheets(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

/** Declarations only, with comments removed: a comment may name a colour, a value may not. */
function colourValues(css: string): string[] {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/[;{}]/)
    .map((decl) => decl.split(":").slice(1).join(":").trim())
    .filter((value) => value.length > 0 && !value.startsWith("//"));
}

describe("home screen colours come from theme tokens", () => {
  const files = HOME_SCREEN_DIRS.flatMap((dir) => stylesheets(join(SRC, dir)));

  it("finds the home screen stylesheets", () => {
    expect(files.length).toBeGreaterThan(HOME_SCREEN_DIRS.length);
  });

  it.each(files.map((f) => [f.slice(SRC.length)]))("%s has no literal colour", (file) => {
    const offending = colourValues(readFileSync(join(SRC, file), "utf8")).filter((value) => LITERAL_COLOUR.test(value));
    expect(offending).toEqual([]);
  });
});
