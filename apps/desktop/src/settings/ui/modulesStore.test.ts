import { describe, expect, it, vi } from "vitest";
import { unavailableNativeApi, type ModuleId, type ModuleStatus, type NativeApi } from "../../lib/native/api";
import { createModulesStore } from "./modulesStore";

const on = (id: ModuleId): ModuleStatus => ({ id, enabled: true, state: "running", requires: null, error: null });
const off = (id: ModuleId): ModuleStatus => ({ id, enabled: false, state: "stopped", requires: null, error: null });

interface Fake {
  readonly api: NativeApi;
  readonly push: (statuses: readonly ModuleStatus[]) => void;
  readonly settle: (result: readonly ModuleStatus[] | Error) => void;
}

/** A core that answers `set` only when the test lets it, so the moment in between can be looked at. */
function fakeCore(initial: readonly ModuleStatus[]): Fake {
  let listener: ((statuses: readonly ModuleStatus[]) => void) | null = null;
  let answer: ((result: readonly ModuleStatus[] | Error) => void) | null = null;
  const api: NativeApi = {
    ...unavailableNativeApi,
    available: true,
    modules: {
      list: () => Promise.resolve(initial),
      set: () =>
        new Promise((resolve, reject) => {
          answer = (result) => (result instanceof Error ? reject(result) : resolve(result));
        }),
      onChange: (handler) => {
        listener = handler;
        return Promise.resolve(() => undefined);
      },
    },
  };
  return {
    api,
    push: (statuses) => listener?.(statuses),
    settle: (result) => answer?.(result),
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("createModulesStore", () => {
  it("is unavailable in a plain browser, without asking anyone", () => {
    const modules = createModulesStore(() => unavailableNativeApi, vi.fn());
    modules.load();
    expect(modules.store.getState().list).toEqual({ status: "unavailable" });
  });

  it("reads the list once, however many switches ask", async () => {
    const list = vi.fn(() => Promise.resolve([on("home")]));
    const core = fakeCore([]);
    const api: NativeApi = { ...core.api, modules: { ...core.api.modules, list } };
    const modules = createModulesStore(() => api, vi.fn());
    modules.load();
    modules.load();
    modules.load();
    await flush();
    expect(list).toHaveBeenCalledTimes(1);
    expect(modules.store.getState().list).toEqual({ status: "ready", data: [on("home")] });
  });

  it("moves the switch at once and settles on the core's answer", async () => {
    const core = fakeCore([on("home"), on("notch")]);
    const modules = createModulesStore(() => core.api, vi.fn());
    modules.load();
    await flush();

    const done = modules.change("home", false);
    const during = modules.shown(modules.store.getState());
    expect(during?.find((m) => m.id === "home")?.enabled).toBe(false);
    expect(modules.store.getState().pending.get("home")).toBe(false);

    core.settle([off("home"), on("notch")]);
    await done;
    expect(modules.store.getState().pending.size).toBe(0);
    expect(modules.shown(modules.store.getState())?.map((m) => m.enabled)).toEqual([false, true]);
  });

  it("puts the switch back and tells the user why when the core refuses", async () => {
    const report = vi.fn();
    const core = fakeCore([on("notch")]);
    const modules = createModulesStore(() => core.api, report);
    modules.load();
    await flush();

    const done = modules.change("notch", false);
    core.settle(new Error("the notch did not start: no Claude Code folder"));
    await done;
    expect(report).toHaveBeenCalledWith("That didn't change: the notch did not start: no Claude Code folder");
    expect(modules.shown(modules.store.getState())?.[0]?.enabled).toBe(true);
    expect(modules.store.getState().pending.size).toBe(0);
  });

  it("follows changes the core pushes, such as a part started from the tray", async () => {
    const core = fakeCore([on("home"), on("notch")]);
    const modules = createModulesStore(() => core.api, vi.fn());
    modules.load();
    await flush();
    core.push([off("home"), on("notch")]);
    expect(modules.store.getState().list).toEqual({ status: "ready", data: [off("home"), on("notch")] });
  });

  it("applies several unanswered choices together", async () => {
    const core = fakeCore([on("home"), on("notch")]);
    const modules = createModulesStore(() => core.api, vi.fn());
    modules.load();
    await flush();
    void modules.change("home", false);
    void modules.change("notch", false);
    expect(modules.shown(modules.store.getState())?.map((m) => m.enabled)).toEqual([false, false]);
  });

  it("shows an error to retry from when the list cannot be read", async () => {
    const core = fakeCore([]);
    const api: NativeApi = { ...core.api, modules: { ...core.api.modules, list: () => Promise.reject("the core is busy") } };
    const modules = createModulesStore(() => api, vi.fn());
    modules.load();
    await flush();
    expect(modules.store.getState().list).toEqual({ status: "error", message: "the core is busy" });
    expect(modules.shown(modules.store.getState())).toBeNull();
  });
});
