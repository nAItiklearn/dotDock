import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getNativeApi, NativeUnavailableError, type NativeApi } from "../../lib/native/api";
import { Button } from "../../lib/ui/controls";
import { Icon, type IconName } from "../../lib/ui/Icon";

export type NativeState<T> =
  | { readonly status: "unavailable" }
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly data: T };

export interface NativeResource<T> {
  readonly state: NativeState<T>;
  readonly reload: () => void;
  /** Replaces the data with a fresh value the core just returned from a write. */
  readonly set: (next: T) => void;
}

function describe(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "The app did not answer.";
}

/**
 * Loads something from the core. Gives a plain browser the "unavailable" state straight away,
 * everything else loading, ready or an error with a way to retry. Never throws into the page.
 */
export function useNativeResource<T>(load: (api: NativeApi) => Promise<T>): NativeResource<T> {
  const api = getNativeApi();
  const [state, setState] = useState<NativeState<T>>(api.available ? { status: "loading" } : { status: "unavailable" });
  const loader = useRef(load);
  loader.current = load;

  const run = useCallback(() => {
    if (!api.available) return;
    setState((s) => (s.status === "ready" ? s : { status: "loading" }));
    loader.current(api).then(
      (data) => setState({ status: "ready", data }),
      (error: unknown) =>
        setState(error instanceof NativeUnavailableError ? { status: "unavailable" } : { status: "error", message: describe(error) }),
    );
  }, [api]);

  useEffect(run, [run]);
  const set = useCallback((data: T) => setState({ status: "ready", data }), []);
  return { state, reload: run, set };
}

export interface NativeGateProps<T> {
  readonly resource: NativeResource<T>;
  readonly icon: IconName;
  /** What this page does once the app is running, as short specific lines. */
  readonly offers: readonly string[];
  readonly children: (data: T) => ReactNode;
}

/** Page body for anything that needs the Rust core: designed states for browser, loading and failure. */
export function NativeGate<T>({ resource, icon, offers, children }: NativeGateProps<T>) {
  const { state, reload } = resource;
  if (state.status === "ready") return <>{children(state.data)}</>;
  if (state.status === "loading") {
    return (
      <div className="gate" role="status" aria-live="polite">
        <span className="gate__dots" aria-hidden="true" />
        <span className="caps">Reading from the app</span>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="gate gate--error" role="alert">
        <span className="gate__icon">
          <Icon name="warning" size={22} />
        </span>
        <h2 className="gate__title">Couldn't read this from the app</h2>
        <p className="gate__text">{state.message}</p>
        <Button icon="reset" onClick={reload}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <div className="gate">
      <span className="gate__icon">
        <Icon name={icon} size={22} />
      </span>
      <h2 className="gate__title">Available in the desktop app</h2>
      <p className="gate__text">This page controls Windows itself, so it only works in the installed app. Here it would let you:</p>
      <ul className="gate__list">
        {offers.map((offer) => (
          <li key={offer}>{offer}</li>
        ))}
      </ul>
    </div>
  );
}
