import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loopedTime, loopWindow } from "../src/lib/videoLoop.ts";
import loops from "../src/data/video-loops.json" with { type: "json" };

describe("looping the recordings", () => {
  it("jumps back to the footage once the closing card begins, and leaves every other time alone", () => {
    const w = { start: 3.2, end: 39.7 };
    assert.equal(loopedTime(39.7, w), 3.2);
    assert.equal(loopedTime(41, w), 3.2);
    assert.equal(loopedTime(39.69, w), 39.69);
    assert.equal(loopedTime(0.5, w), 0.5);
  });

  it("reads a window only from two numbers in order", () => {
    assert.deepEqual(loopWindow("3.2", "39.7"), { start: 3.2, end: 39.7 });
    assert.equal(loopWindow(undefined, "39.7"), null);
    assert.equal(loopWindow("40", "39.7"), null);
    assert.equal(loopWindow("x", "1"), null);
  });

  it("has a window for every recording the site shows, inside its length", () => {
    for (const name of ["tour", "dock", "notch"]) {
      const w = (loops as Record<string, { start: number; end: number }>)[name];
      assert.ok(w && w.start > 0 && w.end > w.start + 10, name);
    }
  });
});
