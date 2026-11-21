/**
 * The emoji the picker offers, taken from the Unicode blocks they live in and kept to the ones that are emoji on their
 * own (`Emoji_Presentation`), so every one draws as a picture and none needs a variation selector.
 */
export type EmojiGroup = "faces" | "hands" | "animals" | "food" | "travel" | "objects";

const RANGES: Readonly<Record<EmojiGroup, readonly (readonly [number, number])[]>> = {
  faces: [[0x1f600, 0x1f64f]],
  hands: [
    [0x1f446, 0x1f450],
    [0x1f64c, 0x1f64c],
    [0x1f91d, 0x1f91f],
  ],
  animals: [
    [0x1f400, 0x1f43e],
    [0x1f980, 0x1f9ae],
  ],
  food: [
    [0x1f345, 0x1f37f],
    [0x1f950, 0x1f96b],
  ],
  travel: [
    [0x1f680, 0x1f6c5],
    [0x1f30d, 0x1f320],
  ],
  objects: [
    [0x1f4a1, 0x1f4fc],
    [0x1f525, 0x1f525],
    [0x2728, 0x2728],
  ],
};

export const EMOJI_GROUPS = Object.keys(RANGES) as readonly EmojiGroup[];

const EMOJI_PRESENTATION = /^\p{Emoji_Presentation}$/u;

const cache = new Map<EmojiGroup, readonly string[]>();

/** The emoji of a group, in code point order. */
export function emojiOf(group: EmojiGroup): readonly string[] {
  const hit = cache.get(group);
  if (hit) return hit;
  const list = RANGES[group].flatMap(([from, to]) =>
    Array.from({ length: to - from + 1 }, (_, i) => String.fromCodePoint(from + i)).filter((c) => EMOJI_PRESENTATION.test(c)),
  );
  cache.set(group, list);
  return list;
}

/** The most emoji the recent row keeps. */
export const RECENT_SIZE = 12;

export function pushRecent(recent: readonly string[], emoji: string): string[] {
  return [emoji, ...recent.filter((e) => e !== emoji)].slice(0, RECENT_SIZE);
}

export function parseRecent(raw: string | null): string[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string" && EMOJI_PRESENTATION.test(v)).slice(0, RECENT_SIZE) : [];
  } catch {
    return [];
  }
}
