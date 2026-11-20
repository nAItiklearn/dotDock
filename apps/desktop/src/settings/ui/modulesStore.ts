import { createStore, type StoreApi } from "zustand/vanilla";
import { NativeUnavailableError, type ModuleId, type ModuleStatus, type NativeApi } from "../../lib/native/api";
import { withChoice } from "../modulesModel";
import type { NativeState } from "./native";

type Statuses = readonly ModuleStatus[];

export interface ModulesState {
  readonly list: NativeState<Statuses>;
  /** Choices sent to the core and not yet answered, by part. The switch shows them at once. */
  readonly pending: ReadonlyMap<ModuleId, boolean>;
}

export interface ModulesStore {
  readonly store: StoreApi<ModulesState>;
  /** Reads the list from the core, and keeps it current from then on. Does nothing while loaded or loading. */
  load(): void;
  /** Reads the list again, e.g. after a failure. */
  reload(): void;
  /** Switches one part now; the answer, or the reason it failed, comes back through the store and `report`. */
  change(id: ModuleId, enabled: boolean): Promise<void>;
  /** The list as the switches should show it: the core's answer with the unanswered choices applied. */
  shown(state: ModulesState): Statuses | null;
}

function describe(error: unknown): string {
  if (typeof error === "string") return error;
  return error instanceof Error ? error.message : "The app did not answer.";
}

/**
 * The state every module switch shares, wherever it sits in Settings: one read from the core, one
 * subscription to its changes, and the choices in flight. `report` shows a failure to the user.
 */
export function createModulesStore(getApi: () => NativeApi, report: (message: string) => void): ModulesStore {
  const store = createStore<ModulesState>()(() => ({
    list: getApi().available ? { status: "loading" } : { status: "unavailable" },
    pending: new Map(),
  }));
  let started = false;
  const setList = (list: NativeState<Statuses>): void => store.setState({ list });

  const read = (): void => {
    const api = getApi();
    if (!api.available) {
      setList({ status: "unavailable" });
      return;
    }
    if (store.getState().list.status !== "ready") setList({ status: "loading" });
    api.modules.list().then(
      (data) => setList({ status: "ready", data }),
      (error: unknown) =>
        setList(error instanceof NativeUnavailableError ? { status: "unavailable" } : { status: "error", message: describe(error) }),
    );
  };

  const follow = (): void => {
    getApi()
      .modules.onChange((data) => setList({ status: "ready", data }))
      // Without the subscription the page still works; it just learns of outside changes on the next read.
      .catch(() => undefined);
  };

  const withPending = (update: (pending: Map<ModuleId, boolean>) => void): void => {
    const next = new Map(store.getState().pending);
    update(next);
    store.setState({ pending: next });
  };

  return {
    store,
    load() {
      if (started) return;
      started = true;
      read();
      if (getApi().available) follow();
    },
    reload: read,
    async change(id, enabled) {
      withPending((p) => p.set(id, enabled));
      try {
        const data = await getApi().modules.set(id, enabled);
        setList({ status: "ready", data });
      } catch (error: unknown) {
        report(`That didn't change: ${describe(error)}`);
      } finally {
        withPending((p) => p.delete(id));
      }
    },
    shown(state) {
      if (state.list.status !== "ready") return null;
      return [...state.pending].reduce<Statuses>((list, [id, enabled]) => withChoice(list, id, enabled), state.list.data);
    },
  };
}
