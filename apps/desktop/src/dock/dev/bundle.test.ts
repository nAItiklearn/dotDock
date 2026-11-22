import react from "@vitejs/plugin-react";
import type { Rollup } from "vite";
import { build } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The fixture panel is for testing the dock in a browser. It must never reach a user, who customises the dock on the dock
 * itself. These tests build the dock page the way a release does and look inside the result.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Strings that only the fixture contains: the panel's title, the devtools handle, a fixture app and a fixture error. */
const FIXTURE_MARKERS = ["DEV fixture", "dockDev", "Northwind Quartet", "The app could not be started."] as const;

async function dockBundle(fixture: boolean): Promise<string> {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const result = await build({
      root,
      configFile: false,
      mode: "production",
      logLevel: "silent",
      plugins: [react()],
      publicDir: false,
      define: { __APP_VERSION__: JSON.stringify("test"), ...(fixture ? { "import.meta.env.VITE_DOCK_FIXTURE": JSON.stringify("1") } : {}) },
      build: { write: false, target: "es2022", rollupOptions: { input: { dock: resolve(root, "dock.html") } } },
    });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => ("output" in r ? r.output : []));
    return outputs.filter((o): o is Rollup.OutputChunk => o.type === "chunk").map((o) => o.code).join("\n");
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}

describe("the dock's production bundle", () => {
  it("contains nothing of the fixture panel", async () => {
    const code = await dockBundle(false);
    expect(code.length).toBeGreaterThan(50_000);
    for (const marker of FIXTURE_MARKERS) expect(code, marker).not.toContain(marker);
  }, 240_000);

  it("can tell: a fixture build of the same page does contain the panel", async () => {
    const code = await dockBundle(true);
    for (const marker of FIXTURE_MARKERS) expect(code, marker).toContain(marker);
  }, 240_000);
});
