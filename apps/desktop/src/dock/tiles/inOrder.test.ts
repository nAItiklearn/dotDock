// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { inOrder } from "./backend";

describe("inOrder", () => {
  it("runs each call after the one before has finished, even when the first is slower", async () => {
    const done: string[] = [];
    const slow = inOrder(() => new Promise<void>((r) => setTimeout(() => (done.push("unwatch"), r()), 20)));
    const fast = inOrder(() => Promise.resolve(done.push("watch")));
    await Promise.all([slow, fast]);
    expect(done).toEqual(["unwatch", "watch"]);
  });

  it("keeps going after a call fails", async () => {
    await expect(inOrder(() => Promise.reject(new Error("x")))).rejects.toThrow("x");
    await expect(inOrder(() => Promise.resolve(7))).resolves.toBe(7);
  });
});
