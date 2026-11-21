import { createStore, type StoreApi } from "zustand/vanilla";
import { NativeUnavailableError, type EnvironmentState, type NativeApi } from "../../lib/native/api";
import type { NativeState } from "./native";

/** Choices sent to the core and not yet answered. The switches show them at once. */
export interface PendingChoices {
  readonly on?: boolean;
}

export interface EnvironmentStoreState {
  readonly env: NativeState<EnvironmentState>;
  readonly pending: PendingChoices;
}

export interface EnvironmentStore {
  readonly store: StoreApi<EnvironmentStoreState>;
  /** Reads the state from the core, and keeps it current from then on. Does nothing once started. */
  load(): void;
  /** Reads it again, e.g. after a failure. */
  reload(): void;
  /** Switches the whole environment on or off. The answer, or the reason it failed, comes back through the store and `report`. */
  setOn(on: boolean): Promise<void>;
  /** The state as the switches should show it: the core's answer with the unanswered choices applied. */
  shown(state: EnvironmentStoreState): EnvironmentState | null;
}

function describe(error: unknown): string {
  if (typeof error === "string") return error;
  return error instanceof Error ? error.message : "The app did not answer.";
}

/**
 * What the two switches at the end of Settings share: one read from the core, one subscription to its
 * changes, and the choices in flight. `report` shows a failure to the user.
 */
export function createEnvironmentStore(getApi: () => NativeApi, report: (message: string) => void): EnvironmentStore {
  const store = createStore<EnvironmentStoreState>()(() => ({
    env: getApi().available ? { status: "loading" } : { status: "unavailable" },
    pending: {},
  }));
  let started = false;
  const setEnv = (env: NativeState<EnvironmentState>): void => store.setState({ env });

  const read = (): void => {
    const api = getApi();
    if (!api.available) {
      setEnv({ status: "unavailable" });
      return;
    }
    if (store.getState().env.status !== "ready") setEnv({ status: "loading" });
    api.environment.get().then(
      (data) => setEnv({ status: "ready", data }),
      (error: unknown) =>
        setEnv(error instanceof NativeUnavailableError ? { status: "unavailable" } : { status: "error", message: describe(error) }),
    );
  };

  const change = async (pending: PendingChoices, ask: (api: NativeApi) => Promise<EnvironmentState>): Promise<void> => {
    const keys = Object.keys(pending) as (keyof PendingChoices)[];
    store.setState({ pending: { ...store.getState().pending, ...pending } });
    try {
      setEnv({ status: "ready", data: await ask(getApi()) });
    } catch (error: unknown) {
      report(`That didn't change: ${describe(error)}`);
    } finally {
      const rest = { ...store.getState().pending };
      keys.forEach((key) => delete rest[key]);
      store.setState({ pending: rest });
    }
  };

  return {
    store,
    load() {
      if (started) return;
      started = true;
      read();
      if (!getApi().available) return;
      getApi()
        .environment.onChange((data) => setEnv({ status: "ready", data }))
        // Without the subscription the switches still work; they just learn of outside changes on the next read.
        .catch(() => undefined);
    },
    reload: read,
    setOn: (on) => change({ on }, (api) => api.environment.setOn(on)),
    shown(state) {
      if (state.env.status !== "ready") return null;
      return { ...state.env.data, ...state.pending };
    },
  };
}
