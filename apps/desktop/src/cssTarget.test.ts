import { describe, expect, it } from "vitest";
import config from "../vite.config";

// light-dark() is native from Chromium 123. Below that target the minifier swaps it for variables that only exist
// where color-scheme is declared in CSS, and the theme sets color-scheme from script, so every such colour broke.
describe("CSS build target", () => {
  it("keeps light-dark() native", () => {
    const target = String(config.build?.cssTarget ?? "");
    const version = Number(/^chrome(\d+)$/.exec(target)?.[1]);
    expect(version).toBeGreaterThanOrEqual(123);
  });
});
