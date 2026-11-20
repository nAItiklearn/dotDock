import type { Contact, ContactAction } from "./ui-types";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const firstLetter = (word: string): string => graphemes.segment(word)[Symbol.iterator]().next().value?.segment ?? "";

/** The letters shown in a contact's avatar: the first of the first and of the last word of the name. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => w !== "");
  const first = firstLetter(words[0] ?? "");
  const last = words.length > 1 ? firstLetter(words[words.length - 1] ?? "") : "";
  return `${first}${last}`.toLocaleUpperCase();
}

/** How many avatars the compact tile draws before it says how many more there are. */
export const AVATARS_SHOWN = 3;

export interface AvatarRow {
  readonly shown: readonly Contact[];
  readonly more: number;
}

export function avatarRow(contacts: readonly Contact[]): AvatarRow {
  return { shown: contacts.slice(0, AVATARS_SHOWN), more: Math.max(0, contacts.length - AVATARS_SHOWN) };
}

/** The order the three ways of reaching someone are always laid out in, so a button is never in a surprising place. */
export const ACTION_ORDER: readonly ContactAction[] = ["call", "video", "message"];

export const sortedChannels = (contact: Contact): Contact["channels"] =>
  [...contact.channels].sort((a, b) => ACTION_ORDER.indexOf(a.action) - ACTION_ORDER.indexOf(b.action));
