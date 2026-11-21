import { afterEach, describe, expect, it, vi } from "vitest";
import { primeActiveIsland } from "./prime";
import { DEFAULT_SETTINGS } from "./protocol";

afterEach(() => vi.unstubAllGlobals());

describe("primeActiveIsland", () => {
  // The soak test traced the first expansion to first-run work of the active tree; it is now done once at idle.
  it("asks for one idle callback with a deadline and does no work before it", () => {
    const idle = vi.fn();
    const createElement = vi.fn();
    vi.stubGlobal("window", { requestIdleCallback: idle });
    vi.stubGlobal("document", { createElement });
    primeActiveIsland(DEFAULT_SETTINGS);
    expect(idle).toHaveBeenCalledTimes(1);
    expect(idle.mock.calls[0]?.[1]).toEqual({ timeout: expect.any(Number) });
    expect(createElement).not.toHaveBeenCalled();
  });
});
