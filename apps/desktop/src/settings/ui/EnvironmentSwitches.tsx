import { useEffect } from "react";
import { useStore } from "zustand";
import { getNativeApi } from "../../lib/native/api";
import { getApp } from "../../lib/state/app";
import { Button, Switch } from "../../lib/ui/controls";
import { createEnvironmentStore, type EnvironmentStore } from "./environmentStore";
import { Row, Section } from "./layout";

let shared: EnvironmentStore | null = null;

function environment(): EnvironmentStore {
  shared ??= createEnvironmentStore(getNativeApi, (message) =>
    getApp().notices.getState().push({ key: "native:environment", level: "error", message }),
  );
  return shared;
}

const WAITING_CHIP = { loading: "Reading…", unavailable: "Needs the desktop app", error: "Couldn't read" } as const;

/**
 * The only two switches over the dotDock environment, kept low-key at the very end of Settings:
 * the whole environment on or off, and the Windows taskbar instead of the dock's replacement.
 * A self-contained section, so it can sit at the end of whichever page or group closes Settings.
 */
export function EnvironmentSwitches() {
  const store = environment();
  useEffect(() => {
    store.load();
  }, [store]);
  const state = useStore(store.store, (s) => s);
  const shown = store.shown(state);
  const waiting = state.env.status === "ready" ? null : WAITING_CHIP[state.env.status];

  return (
    <Section title="Advanced" description="Rarely needed. Both take effect at once and are remembered.">
      <Row
        id="environment-on"
        label="Use the dotDock desktop"
        description={
          <>
            Widgets, dock and notch run together, and stop together. Off leaves plain Windows; your settings and layouts are kept, and
            turning it on brings everything back.
            {shown?.problems.map((problem) => (
              <span key={problem} className="row__warn">
                {" "}
                {problem}
              </span>
            ))}
          </>
        }
      >
        {waiting ? <span className="chip">{waiting}</span> : null}
        {state.env.status === "error" ? (
          <Button variant="ghost" icon="reset" onClick={store.reload}>
            Try again
          </Button>
        ) : null}
        <Switch
          checked={shown?.on ?? false}
          label="Use the dotDock desktop"
          disabled={!shown || state.pending.on !== undefined}
          onChange={(on) => void store.setOn(on)}
        />
      </Row>
      <Row
        id="windows-taskbar"
        label="Use the Windows taskbar"
        description={
          shown && !shown.taskbarReplacement
            ? "Shows the Windows taskbar. The dock's own taskbar is not in this build yet, so Windows' stays."
            : "Shows the Windows taskbar instead of the dock's replacement. The dock stays."
        }
      >
        <Switch
          checked={shown?.windowsTaskbar ?? false}
          label="Use the Windows taskbar"
          disabled={!shown || !shown.taskbarReplacement || state.pending.windowsTaskbar !== undefined}
          onChange={(useWindows) => void store.setWindowsTaskbar(useWindows)}
        />
      </Row>
    </Section>
  );
}
