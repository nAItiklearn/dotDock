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

/** What the theme switch does: the dock, widgets, notch and wallpaper, as one. */
export const THEME_DESCRIPTION =
  "The dock, your widgets, the notch and dotDock's wallpaper, as one. Off gives Windows its desktop back: its taskbar, its startup list and your own wallpaper, the one you had before dotDock or the one you picked while it was off. On brings dotDock back as you left it. Your settings and layouts are kept either way.";

/** What "Use the Windows taskbar" does while the dock can take the taskbar's place. */
export const TASKBAR_SWITCH =
  "Shows the Windows taskbar again, with its own auto-hide setting, and hides the dotDock dock. Your widgets, the notch and the wallpaper stay.";

/** Why the taskbar switch cannot move: the dock did not start in this run, so nothing can replace the Windows taskbar. */
export const TASKBAR_WITHOUT_DOCK =
  "The dock did not start this time, so the Windows taskbar stays. Start dotDock again to bring the dock back; this switch works once it runs.";

const WAITING_CHIP = { loading: "Reading…", unavailable: "Needs the desktop app", error: "Couldn't read" } as const;

/**
 * The only two switches over the dotDock environment, kept low-key at the very end of Settings:
 * the dotDock theme (the whole environment) on or off, and the Windows taskbar instead of the dock's replacement.
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
    <Section title="dotDock and Windows" description="Rarely needed. Both take effect at once and are remembered.">
      <Row
        id="environment-on"
        label="dotDock theme"
        description={
          <>
            {THEME_DESCRIPTION}
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
          label="dotDock theme"
          disabled={!shown || state.pending.on !== undefined}
          onChange={(on) => void store.setOn(on)}
        />
      </Row>
      <Row
        id="windows-taskbar"
        label="Use the Windows taskbar"
        description={
          shown?.taskbarReplacement ? TASKBAR_SWITCH : TASKBAR_WITHOUT_DOCK
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
