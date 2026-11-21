import { describe, expect, it } from "vitest";
import { addMemo, bars, clockText, loudness, MAX_MEMOS, type MemoMeta } from "./memo";

describe("the voice memo's waveform", () => {
  it("is silent for a flat signal and full for a loud one", () => {
    expect(loudness(new Uint8Array(64).fill(128))).toBe(0);
    const loud = Uint8Array.from({ length: 64 }, (_, i) => (i % 2 === 0 ? 255 : 0));
    expect(loudness(loud)).toBe(1);
    expect(loudness([])).toBe(0);
  });

  it("grows with the signal", () => {
    const wave = (amp: number) => Uint8Array.from({ length: 128 }, (_, i) => 128 + Math.round(amp * Math.sin(i / 4)));
    expect(loudness(wave(10))).toBeLessThan(loudness(wave(40)));
  });

  it("keeps the peak of each share, so a short word is not averaged away", () => {
    const levels = [0, 0, 0, 0.9, 0, 0, 0, 0];
    expect(bars(levels, 4)).toEqual([0, 0.9, 0, 0]);
    expect(bars([0.5], 3)).toEqual([0.5, 0.5, 0.5]);
    expect(bars([], 2)).toEqual([0, 0]);
  });

  it("shows minutes and seconds", () => {
    expect(clockText(7_400)).toBe("0:07");
    expect(clockText(750_000)).toBe("12:30");
    expect(clockText(-5)).toBe("0:00");
  });
});

describe("the memo list", () => {
  const memo = (id: string): MemoMeta => ({ id, createdAt: 0, durationMs: 1000, peaks: [] });

  it("adds the newest first and drops the oldest past the limit", () => {
    let list: MemoMeta[] = [];
    for (let i = 0; i < MAX_MEMOS; i += 1) list = addMemo(list, memo(`m${i}`)).kept;
    const { kept, dropped } = addMemo(list, memo("new"));
    expect(kept[0]?.id).toBe("new");
    expect(kept).toHaveLength(MAX_MEMOS);
    expect(dropped.map((m) => m.id)).toEqual(["m0"]);
  });
});
