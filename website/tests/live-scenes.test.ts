// The living scenes (src/lib/live-scenes.ts, components/LiveScene.astro): every piece a scene stacks exists in the
// generated art in both renders, every motion, path and beat has its rules in styles/live.css, and the pivots
// from tools/site-art lie on the stage.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { SCENES, SPECKS, STAGE, pivotOf } from "../src/lib/live-scenes.ts";

const manifest = JSON.parse(readFileSync(new URL("../src/assets/art/manifest.json", import.meta.url), "utf8"));
const css = readFileSync(new URL("../src/styles/live.css", import.meta.url), "utf8");
const ENDS_A_CLASS = new Set([" ", ",", ".", "{", ":", ">", "\n", "\r"]);
/** Whether live.css has a rule for this exact selector, not just for a class whose name starts with it. */
const rule = (selector: string) => css.split(selector).slice(1).some((after) => ENDS_A_CLASS.has(after.charAt(0)));

describe("living scenes", () => {
  for (const [name, scene] of Object.entries(SCENES)) {
    it(`${name}: every piece has a wide and a narrow render`, () => {
      for (const { piece } of [...scene.layers, ...scene.sprites]) {
        assert.ok(manifest[piece], `${piece} is not in the art manifest`);
        assert.ok(manifest[piece].variants.wide && manifest[piece].variants.narrow, `${piece} lacks a render`);
      }
    });
    it(`${name}: every motion, path, beat and speck has its CSS`, () => {
      const selectors = [
        ...scene.layers.filter((l) => l.motion !== "still").map((l) => `.live__m-${l.motion}`),
        ...scene.sprites.flatMap((s) => [`.live__path-${s.path}`, `.live__beat-${s.beat}`]),
        ...scene.specks.colours.map((c) => `.live__c-${c}`),
        ...Array.from({ length: SPECKS }, (_, i) => `.live__speck--${scene.specks.kind}.live__speck--${i + 1}`),
      ];
      for (const s of selectors) assert.ok(rule(s), `no rule for ${s}`);
    });
    it(`${name}: pivots and starting points lie on the stage`, () => {
      for (const l of scene.layers) {
        const p = pivotOf(l.pivot);
        if (!p) continue;
        for (const v of [p.wide, p.narrow]) for (const n of v.split(" ").map(parseFloat)) assert.ok(n >= 0 && n <= 100, `${l.piece} pivot ${v}`);
      }
      for (const s of scene.sprites) assert.ok(s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1, `${s.piece} starts off the stage`);
    });
    it(`${name}: a phone still sees at least one sprite`, () => {
      assert.ok(scene.sprites.some((s) => !s.wideOnly));
    });
  }
  it("the stage keeps the aspect the art was drawn at", () => {
    for (const v of ["wide", "narrow"] as const) {
      for (const scene of Object.values(SCENES)) {
        const land = manifest[scene.layers[0]!.piece].variants[v];
        assert.equal(STAGE[v], `${land.w} / ${land.h}`);
      }
    }
  });
  it("a rule for a longer class name does not count as a rule for a shorter one", () => {
    assert.equal(rule(".live__m-sw"), false);
    assert.equal(rule(".live__m-sway"), true);
  });
});
