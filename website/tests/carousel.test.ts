// Run with `pnpm test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nearestSlide, nextSlide, shouldAdvance } from "../src/lib/carousel.ts";

describe("island carousel", () => {
  it("moves to the next slide and wraps after the last", () => {
    assert.equal(nextSlide(0, 4), 1);
    assert.equal(nextSlide(3, 4), 0);
    assert.equal(nextSlide(0, 0), 0);
  });
  it("finds the slide nearest the scroll position", () => {
    const offsets = [0, 400, 800, 1200];
    assert.equal(nearestSlide(0, offsets), 0);
    assert.equal(nearestSlide(590, offsets), 1);
    assert.equal(nearestSlide(610, offsets), 2);
    assert.equal(nearestSlide(5000, offsets), 3);
  });
  it("advances only while playing, on screen, not hovered and not focused", () => {
    const on = { playing: true, visible: true, hovered: false, focused: false };
    assert.equal(shouldAdvance(on), true);
    assert.equal(shouldAdvance({ ...on, playing: false }), false);
    assert.equal(shouldAdvance({ ...on, visible: false }), false);
    assert.equal(shouldAdvance({ ...on, hovered: true }), false);
    assert.equal(shouldAdvance({ ...on, focused: true }), false);
  });
});
