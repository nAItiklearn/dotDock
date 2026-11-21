import { describe, expect, it, vi } from "vitest";

// Stubbed before the imports below run: the island modules prime.tsx shares read `window` when they load.
const stubs = vi.hoisted(() => {
  const idle = vi.fn();
  const createElement = vi.fn();
  vi.stubGlobal("window", { requestIdleCallback: idle });
  vi.stubGlobal("document", { createElement });
  return { idle, createElement };
});

import { primeActiveIsland } from "./prime";
import { DEFAULT_SETTINGS } from "./protocol";

describe("primeActiveIsland", () => {
  // The soak test traced the first expansion to first-run work of the active tree; it is now done once at idle.
  it("asks for one idle callback with a deadline and does no work before it", () => {
    primeActiveIsland(DEFAULT_SETTINGS);
    expect(stubs.idle).toHaveBeenCalledTimes(1);
    expect(stubs.idle.mock.calls[0]?.[1]).toEqual({ timeout: expect.any(Number) });
    expect(stubs.createElement).not.toHaveBeenCalled();
  });
});
