import { describe, expect, it } from "vitest";
import { BUCKET_STEP, bucketWidth, CopyCache, KEPT_COPIES, MIN_BUCKET } from "./decode";

class Copy {
  closed = false;
  constructor(readonly width: number) {}
  close(): void {
    this.closed = true;
  }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("bucketWidth", () => {
  it("never decodes a copy smaller than the pixels it fills, nor more than one step larger", () => {
    for (let target = MIN_BUCKET + 1; target < 6000; target += 7) {
      const w = bucketWidth(target, 6000);
      expect(w).toBeGreaterThanOrEqual(target - 0.5);
      expect(w / target).toBeLessThanOrEqual(BUCKET_STEP + 0.01);
    }
  });

  it("is never larger than the original and has a floor for tiny images", () => {
    expect(bucketWidth(5000, 1200)).toBe(1200);
    expect(bucketWidth(10, 6000)).toBe(MIN_BUCKET);
    expect(bucketWidth(10, 100)).toBe(100);
    expect(bucketWidth(500, 0)).toBe(0);
  });

  it("grows with the target, so a bigger window never gets a smaller copy", () => {
    let previous = 0;
    for (let target = 1; target < 8000; target += 13) {
      const w = bucketWidth(target, 6000);
      expect(w).toBeGreaterThanOrEqual(previous);
      previous = w;
    }
  });
});

describe("CopyCache", () => {
  it("decodes a width once and hands the same copy back", async () => {
    const asked: number[] = [];
    const cache = new CopyCache(async (w) => {
      asked.push(w);
      return new Copy(w);
    });
    const a = await cache.get(512);
    const b = await cache.get(512);
    expect(a).toBe(b);
    expect(asked).toEqual([512]);
  });

  it("keeps the most recently used copies and closes the one it drops", async () => {
    const made = new Map<number, Copy>();
    const cache = new CopyCache(async (w) => {
      const c = new Copy(w);
      made.set(w, c);
      return c;
    });
    for (let i = 0; i < KEPT_COPIES; i += 1) await cache.get(300 + i);
    await cache.get(300); // 300 is now the most recent, 301 the oldest
    await cache.get(400);
    await settle();
    expect(made.get(301)?.closed).toBe(true);
    expect(made.get(300)?.closed).toBe(false);
    expect(made.get(400)?.closed).toBe(false);
  });

  it("forgets a failed decode so the next request tries again", async () => {
    let fail = true;
    const cache = new CopyCache(async (w) => {
      if (fail) throw new Error("decode failed");
      return new Copy(w);
    });
    await expect(cache.get(512)).rejects.toThrow("decode failed");
    fail = false;
    await expect(cache.get(512)).resolves.toBeInstanceOf(Copy);
  });

  it("closes everything on dispose", async () => {
    const made: Copy[] = [];
    const cache = new CopyCache(async (w) => {
      const c = new Copy(w);
      made.push(c);
      return c;
    });
    await cache.get(256);
    await cache.get(512);
    cache.dispose();
    await settle();
    expect(made.every((c) => c.closed)).toBe(true);
  });
});
