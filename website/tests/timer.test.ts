// Run with `pnpm test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TIMER_MINUTES, TIMER_SECONDS, minutesLit } from "../src/lib/timer.ts";

describe("focus timer minute dots", () => {
  it("lights every dot before the timer starts", () => {
    assert.equal(minutesLit(TIMER_SECONDS), TIMER_MINUTES);
  });
  it("keeps a started minute lit", () => {
    assert.equal(minutesLit(TIMER_SECONDS - 1), TIMER_MINUTES);
    assert.equal(minutesLit(61), 2);
    assert.equal(minutesLit(60), 1);
  });
  it("goes dark at zero and never leaves the range", () => {
    assert.equal(minutesLit(0), 0);
    assert.equal(minutesLit(-5), 0);
    assert.equal(minutesLit(TIMER_SECONDS * 2), TIMER_MINUTES);
  });
});
