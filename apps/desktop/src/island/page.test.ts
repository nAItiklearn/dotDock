import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(resolve(__dirname, "../../island.html"), "utf8");

describe("island.html", () => {
  // The soak test caught this: without an icon of its own the WebView requests /favicon.ico, the server answers
  // 404 and the island's console shows an error on every start.
  it("declares an inline icon so the page never requests /favicon.ico", () => {
    expect(html).toMatch(/<link rel="icon" href="data:,"\s*\/>/);
  });
});
