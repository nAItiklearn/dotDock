// The flattened scene art (tools/flatten-art.mjs, src/lib/art-flat.ts): every band and scene layer has its
// pictures for every render, theme and pixel ratio, and the small sprites keep their masks.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { FLAT_PIECES, flatFile, isFlat } from "../src/lib/art-flat.ts";
import { THEMES } from "../src/lib/themes.ts";

const manifest = JSON.parse(readFileSync(new URL("../src/assets/art/manifest.json", import.meta.url), "utf8"));
const sources = JSON.parse(readFileSync(new URL("../src/assets/art-flat/sources.json", import.meta.url), "utf8"));

describe("flattened art", () => {
  it("covers the bands and the scene layers, not the sprites", () => {
    assert.ok(isFlat("band-pond") && isFlat("live-paddock-land") && isFlat("vista-sway-a"));
    assert.ok(!isFlat("live-dragonfly") && !isFlat("live-fish-gold") && !isFlat("vista-butterfly-red"));
  });
  it("has every render, theme and pixel ratio of every flattened piece on disk, drawn from today's masks", () => {
    for (const name of FLAT_PIECES) {
      assert.ok(sources[name], `${name} was never flattened (run node tools/flatten-art.mjs)`);
      for (const variant of Object.keys(manifest[name].variants)) {
        for (const theme of THEMES) {
          for (const scale of [1, 2]) {
            const file = new URL(`../src/assets/art-flat/${flatFile(name, variant, theme.id, scale)}`, import.meta.url);
            assert.ok(existsSync(file), `missing ${flatFile(name, variant, theme.id, scale)}`);
          }
        }
      }
    }
  });
});
