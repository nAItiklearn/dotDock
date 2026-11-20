import { describe, expect, it } from "vitest";
import { ACTION_ORDER, avatarRow, AVATARS_SHOWN, initials, sortedChannels } from "./contacts";
import type { Contact } from "./ui-types";

const contact = (id: string, name: string, actions: readonly Contact["channels"][number]["action"][] = ["call"]): Contact => ({
  id,
  name,
  channels: actions.map((action) => ({ action, app: "App" })),
});

describe("initials", () => {
  it("takes the first letter of the first and the last word", () => {
    expect(initials("Maya Okafor")).toBe("MO");
    expect(initials("  jean   claude  van  damme ")).toBe("JD");
  });

  it("uses one letter for one word, and survives nothing at all", () => {
    expect(initials("Priya")).toBe("P");
    expect(initials("")).toBe("");
    expect(initials("   ")).toBe("");
  });

  it("does not split an emoji or an accented letter in half", () => {
    expect(initials("Élodie Saint-Pierre")).toBe("ÉS");
    expect(initials("👩‍💻 Dev")).toBe("👩‍💻D");
  });
});

describe("avatarRow", () => {
  it("shows the first few and counts the rest", () => {
    const people = Array.from({ length: AVATARS_SHOWN + 2 }, (_, i) => contact(String(i), `P${i} X`));
    const row = avatarRow(people);
    expect(row.shown).toHaveLength(AVATARS_SHOWN);
    expect(row.more).toBe(2);
  });

  it("has no more when everyone fits, and is empty for nobody", () => {
    expect(avatarRow([contact("a", "A B")]).more).toBe(0);
    expect(avatarRow([])).toEqual({ shown: [], more: 0 });
  });
});

describe("sortedChannels", () => {
  it("always lays the buttons out call, video, message", () => {
    const shuffled = contact("a", "A B", ["message", "call", "video"]);
    expect(sortedChannels(shuffled).map((c) => c.action)).toEqual([...ACTION_ORDER]);
  });

  it("leaves out the ways that were not set up", () => {
    expect(sortedChannels(contact("a", "A B", ["message", "call"])).map((c) => c.action)).toEqual(["call", "message"]);
  });

  it("does not change the contact it was given", () => {
    const c = contact("a", "A B", ["message", "call"]);
    sortedChannels(c);
    expect(c.channels.map((x) => x.action)).toEqual(["message", "call"]);
  });
});
