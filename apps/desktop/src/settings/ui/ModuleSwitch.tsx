import { useEffect } from "react";
import { useStore } from "zustand";
import { getNativeApi, type ModuleId, type ModuleStatus } from "../../lib/native/api";
import { getApp } from "../../lib/state/app";
import { Switch } from "../../lib/ui/controls";
import { MODULE_COPY, viewOf } from "../modulesModel";
import { createModulesStore, type ModulesStore } from "./modulesStore";
import type { NativeResource } from "./native";
import { Row, Section } from "./layout";

/**
 * The module switches, as pieces any part of Settings can place: one row per part
 * (`ModuleSwitchRow`), or all of them in a section (`ModulesSection`). They share one state, so a
 * switch in the dock's section and the same switch on another page always agree.
 */

let shared: ModulesStore | null = null;

function modules(): ModulesStore {
  shared ??= createModulesStore(getNativeApi, (message) =>
    getApp().notices.getState().push({ key: "native:modules", level: "error", message }),
  );
  return shared;
}

/** Starts reading the list once the first switch is on screen. */
function useLoaded(store: ModulesStore): void {
  useEffect(() => {
    store.load();
  }, [store]);
}

/** The shared list as a native resource, for a page that wants the full-page "needs the desktop app" states. */
export function useModulesResource(): NativeResource<readonly ModuleStatus[]> {
  const store = modules();
  useLoaded(store);
  const list = useStore(store.store, (s) => s.list);
  return {
    state: list,
    reload: store.reload,
    set: (data) => store.store.setState({ list: { status: "ready", data } }),
  };
}

const WAITING_CHIP = { loading: "Reading…", unavailable: "Needs the desktop app", error: "Couldn't read" } as const;

export function ModuleSwitchRow({ id }: { readonly id: ModuleId }) {
  const store = modules();
  useLoaded(store);
  const state = useStore(store.store, (s) => s);
  const copy = MODULE_COPY.find((c) => c.id === id);
  if (!copy) return null;
  const shown = store.shown(state);
  const status = shown?.find((m) => m.id === id);

  if (!shown || !status) {
    const chip = state.list.status === "ready" ? "Not in this build" : WAITING_CHIP[state.list.status];
    return (
      <Row id={copy.rowId} label={copy.label} description={copy.description}>
        <span className="chip">{chip}</span>
        <Switch checked={false} label={copy.label} disabled onChange={() => undefined} />
      </Row>
    );
  }

  const view = viewOf(status, shown);
  return (
    <Row
      id={copy.rowId}
      label={copy.label}
      description={
        <>
          {copy.description}
          {view.note ? <span className={status.state === "failed" ? "row__warn" : undefined}> {view.note}</span> : null}
        </>
      }
    >
      <span className="chip">{view.chip}</span>
      <Switch
        checked={status.enabled}
        label={copy.label}
        disabled={!view.canSwitch || state.pending.has(id)}
        onChange={(enabled) => void store.change(id, enabled)}
      />
    </Row>
  );
}

export function ModulesSection() {
  return (
    <Section title="Parts" description="Each part runs on its own. Switch off what you don't use; it stops at once and stays off.">
      {MODULE_COPY.map((copy) => (
        <ModuleSwitchRow key={copy.id} id={copy.id} />
      ))}
    </Section>
  );
}
