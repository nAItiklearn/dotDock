// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { OFFER_ANSWERED_KEY, offerAnswered, shouldOffer } from "./ConnectOffer";
import type { ConnectionState, ConnectionStatus } from "./protocol";

const status = (state: ConnectionState): ConnectionStatus =>
  ({ state, settingsPath: "", codexAvailable: false, agents: [], feedDir: "" });

describe("the notch's connect offer", () => {
  it("shows only while Claude Code is installed, not connected, idle and not answered", () => {
    expect(shouldOffer(status("disconnected"), false, false)).toBe(true);
    expect(shouldOffer(status("disconnected"), true, false)).toBe(false);
    expect(shouldOffer(status("disconnected"), false, true)).toBe(false);
    for (const state of ["connected", "no-claude", "outdated", "hook-missing"] as const) {
      expect(shouldOffer(status(state), false, false)).toBe(false);
    }
    expect(shouldOffer(null, false, false)).toBe(false);
  });

  it("remembers an answer, and treats storage it cannot read as unanswered", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null };
    expect(offerAnswered(storage)).toBe(false);
    store.set(OFFER_ANSWERED_KEY, "declined");
    expect(offerAnswered(storage)).toBe(true);
    expect(offerAnswered({ getItem: () => { throw new Error("blocked"); } })).toBe(false);
  });
});
