import { describe, expect, it, vi } from "vitest";
import { unavailableNativeApi, type EnvironmentState, type NativeApi } from "../../lib/native/api";
import { createEnvironmentStore } from "./environmentStore";

const state = (patch: Partial<EnvironmentState> = {}): EnvironmentState => ({
  on: true,
  problems: [],
  ...patch,
});

/** A core that answers a change only when the test lets it, so the moment in between can be looked at. */
function fakeCore(initial: EnvironmentState) {
  let listener: ((next: EnvironmentState) => void) | null = null;
  let answer: ((result: EnvironmentState | Error | string) => void) | null = null;
  const asked: string[] = [];
  const respond = (what: string): Promise<EnvironmentState> =>
    new Promise((resolve, reject) => {
      asked.push(what);
      answer = (result) => (result instanceof Error || typeof result === "string" ? reject(result) : resolve(result));
    });
  const get = vi.fn(() => Promise.resolve(initial));
  const api: NativeApi = {
    ...unavailableNativeApi,
    available: true,
    environment: {
      get,
      setOn: (on) => respond(`on=${on}`),
      onChange: (handler) => {
        listener = handler;
        return Promise.resolve(() => undefined);
      },
    },
  };
  return {
    api,
    get,
    asked,
    push: (next: EnvironmentState) => listener?.(next),
    settle: (result: EnvironmentState | Error | string) => answer?.(result),
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("createEnvironmentStore", () => {
  it("is unavailable in a plain browser, without asking anyone", () => {
    const environment = createEnvironmentStore(() => unavailableNativeApi, vi.fn());
    environment.load();
    expect(environment.store.getState().env).toEqual({ status: "unavailable" });
    expect(environment.shown(environment.store.getState())).toBeNull();
  });

  it("reads the state once, however many times it is asked to load", async () => {
    const core = fakeCore(state());
    const environment = createEnvironmentStore(() => core.api, vi.fn());
    environment.load();
    environment.load();
    await flush();
    expect(core.get).toHaveBeenCalledTimes(1);
    expect(environment.store.getState().env).toEqual({ status: "ready", data: state() });
  });

  it("moves the switch at once and settles on the core's answer", async () => {
    const core = fakeCore(state());
    const environment = createEnvironmentStore(() => core.api, vi.fn());
    environment.load();
    await flush();

    const done = environment.setOn(false);
    expect(core.asked).toEqual(["on=false"]);
    expect(environment.shown(environment.store.getState())?.on).toBe(false);

    core.settle(state({ on: false }));
    await done;
    expect(environment.store.getState().pending).toEqual({});
    expect(environment.shown(environment.store.getState())?.on).toBe(false);
  });

  it("puts the switch back and says why when the core refuses", async () => {
    const report = vi.fn();
    const core = fakeCore(state());
    const environment = createEnvironmentStore(() => core.api, report);
    environment.load();
    await flush();

    const done = environment.setOn(false);
    expect(environment.shown(environment.store.getState())?.on).toBe(false);
    core.settle("the settings could not be saved");
    await done;
    expect(report).toHaveBeenCalledWith("That didn't change: the settings could not be saved");
    expect(environment.store.getState().pending).toEqual({});
    expect(environment.shown(environment.store.getState())?.on).toBe(true);
  });

  it("follows changes the core pushes, such as the environment turned off from elsewhere", async () => {
    const core = fakeCore(state());
    const environment = createEnvironmentStore(() => core.api, vi.fn());
    environment.load();
    await flush();
    core.push(state({ on: false }));
    expect(environment.shown(environment.store.getState())?.on).toBe(false);
  });

  it("carries what did not start to the page in the core's words", async () => {
    const core = fakeCore(state({ problems: ["Notch: No Claude Code folder was found."] }));
    const environment = createEnvironmentStore(() => core.api, vi.fn());
    environment.load();
    await flush();
    expect(environment.shown(environment.store.getState())?.problems).toEqual(["Notch: No Claude Code folder was found."]);
  });

  it("offers a retry when the state cannot be read", async () => {
    const core = fakeCore(state());
    const failing: NativeApi = { ...core.api, environment: { ...core.api.environment, get: () => Promise.reject("the core is busy") } };
    const environment = createEnvironmentStore(() => failing, vi.fn());
    environment.load();
    await flush();
    expect(environment.store.getState().env).toEqual({ status: "error", message: "the core is busy" });
  });
});
