import { describe, expect, it } from "vitest";
import { dropIndex, dropIntent, moveKey, slideOffsets, slotStart, type LaneSpan } from "./reorder";

const SIZE = 48;
const GAP = 7;
const lane: LaneSpan[] = [
  { key: "a", start: 100, size: SIZE, isStack: false },
  { key: "b", start: 155, size: SIZE, isStack: true },
  { key: "c", start: 210, size: SIZE, isStack: false },
  { key: "d", start: 265, size: SIZE, isStack: false },
];

describe("dropIndex", () => {
  it("counts the other items whose centre is before the dragged centre", () => {
    expect(dropIndex(lane, "a", 0)).toBe(0);
    expect(dropIndex(lane, "a", 240)).toBe(2);
    expect(dropIndex(lane, "a", 900)).toBe(3);
    expect(dropIndex(lane, "d", 150)).toBe(1);
    expect(dropIndex(lane, "d", 110)).toBe(0);
  });
});

describe("dropIntent", () => {
  it("files an app dropped on the middle of a stack", () => {
    expect(dropIntent(lane, "a", true, 155 + SIZE / 2)).toEqual({ type: "file", stackKey: "b" });
  });
  it("reorders when dropped on a stack's edge, or when the dragged item is a stack or tile", () => {
    expect(dropIntent(lane, "a", true, 155 + 2)).toEqual({ type: "reorder", index: 0 });
    expect(dropIntent(lane, "c", false, 155 + SIZE / 2)).toEqual({ type: "reorder", index: 1 });
  });
  it("never files a stack into itself", () => {
    expect(dropIntent(lane, "b", true, 155 + SIZE / 2).type).toBe("reorder");
  });
});

describe("moveKey", () => {
  it("moves a key to an index among the others", () => {
    expect(moveKey(["a", "b", "c", "d"], "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveKey(["a", "b", "c", "d"], "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveKey(["a", "b"], "a", 99)).toEqual(["b", "a"]);
  });
  it("leaves the list alone for an unknown key", () => {
    expect(moveKey(["a", "b"], "z", 0)).toEqual(["a", "b"]);
  });
});

describe("slideOffsets", () => {
  it("slides the items between the old and the new slot by one slot each", () => {
    const offsets = slideOffsets(lane, "a", 2, GAP);
    expect(offsets.get("b")).toBe(-(SIZE + GAP));
    expect(offsets.get("c")).toBe(-(SIZE + GAP));
    expect(offsets.get("d")).toBe(0);
    expect(offsets.has("a")).toBe(false);
  });
  it("slides the other way when dragging backwards", () => {
    const offsets = slideOffsets(lane, "d", 0, GAP);
    expect(offsets.get("a")).toBe(SIZE + GAP);
    expect(offsets.get("c")).toBe(SIZE + GAP);
  });
  it("moves nothing when the drag has not left its own slot", () => {
    expect([...slideOffsets(lane, "b", 1, GAP).values()].every((v) => v === 0)).toBe(true);
  });
  it("handles tiles of different sizes", () => {
    const mixed: LaneSpan[] = [
      { key: "t", start: 0, size: 110, isStack: false },
      { key: "u", start: 117, size: 48, isStack: false },
    ];
    expect(slideOffsets(mixed, "t", 1, GAP).get("u")).toBe(-117);
    expect(slotStart(mixed, "t", 1, GAP)).toBe(48 + GAP);
  });
});

describe("slotStart", () => {
  it("is where the dragged item settles", () => {
    expect(slotStart(lane, "a", 2, GAP)).toBe(100 + 2 * (SIZE + GAP));
    expect(slotStart(lane, "d", 0, GAP)).toBe(100);
    expect(slotStart([], "a", 0, GAP)).toBeNull();
  });
});
