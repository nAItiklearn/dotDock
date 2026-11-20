import { afterEach, describe, expect, it, vi } from "vitest";
import { chimeReady, claimChime } from "./chime";
import { finishKey, INITIAL_TIMER } from "./timerModel";

function stubStorage(): Map<string, string> {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
  return data;
}

afterEach(() => vi.unstubAllGlobals());

describe("claimChime", () => {
  it("lets the first window that sees a finish chime, and the others stay quiet", () => {
    stubStorage();
    expect(claimChime("1000:pomodoro:focus:0")).toBe(true);
    expect(claimChime("1000:pomodoro:focus:0")).toBe(false);
  });

  it("lets the next finish chime again", () => {
    stubStorage();
    expect(claimChime("1000:pomodoro:focus:0")).toBe(true);
    expect(claimChime("2000:pomodoro:short:1")).toBe(true);
  });

  it("chimes rather than stay silent when there is no storage to agree through", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
    });
    expect(claimChime("x")).toBe(true);
  });
});

describe("chimeReady", () => {
  it("is false until a click has started this window's audio", () => {
    expect(chimeReady()).toBe(false);
  });
});

describe("finishKey", () => {
  it("names a finish by when it started and what it was, so each run has its own", () => {
    const run = { ...INITIAL_TIMER, mode: "pomodoro" as const, status: "running" as const, startedAt: 5000, phase: "focus" as const, focusDone: 1 };
    expect(finishKey(run)).toBe("5000:pomodoro:focus:1");
    expect(finishKey({ ...run, startedAt: 9000 })).not.toBe(finishKey(run));
    expect(finishKey({ ...run, phase: "short" })).not.toBe(finishKey(run));
  });
});
