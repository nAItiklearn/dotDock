import type { StartupState, StartupToggle } from "../../lib/native/api";
import { getNativeApi } from "../../lib/native/api";
import { Switch } from "../../lib/ui/controls";
import { NativeGate, useNativeResource, useNativeWrite, type NativeResource } from "../ui/native";
import { PageHeader, Row, Section } from "../ui/layout";

/** One startup setting changed at once on screen, then in Windows. Shared with the Recovery page. */
export function useStartupChange(resource: NativeResource<StartupState>): (setting: StartupToggle, value: boolean) => void {
  const write = useNativeWrite(resource, "That didn't change");
  return (setting, value) => write((state) => ({ ...state, [setting]: value }), () => getNativeApi().startup.set(setting, value));
}

function StartupBody({ resource, state }: { readonly resource: NativeResource<StartupState>; readonly state: StartupState }) {
  const change = useStartupChange(resource);
  return (
    <>
      <Section title="With Windows">
        <Row id="launch" label="Launch at sign-in" description="Starts with no delay, so the desktop is ready when Windows is.">
          <Switch checked={state.launchAtSignIn} label="Launch at sign-in" onChange={(v) => change("launchAtSignIn", v)} />
        </Row>
        <Row id="desktop-icons" label="Hide desktop icons" description="Hides the stock icons behind your widgets. They come back whenever you restore Windows.">
          <Switch checked={state.hideDesktopIcons} label="Hide desktop icons" onChange={(v) => change("hideDesktopIcons", v)} />
        </Row>
        <Row id="startup-delay" label="Windows startup delay" description="Windows normally waits about ten seconds before starting your apps. Launch at sign-in removes the wait.">
          <span className="chip">{state.startupDelayRemoved ? "Removed" : "Windows default"}</span>
        </Row>
      </Section>
    </>
  );
}

export function StartupPage() {
  const resource = useNativeResource((api) => api.startup.get());
  return (
    <>
      <PageHeader page="startup" />
      <NativeGate
        resource={resource}
        icon="power"
        offers={["Start with Windows, with no startup delay.", "Hide the stock desktop icons behind your widgets."]}
      >
        {(state) => <StartupBody resource={resource} state={state} />}
      </NativeGate>
    </>
  );
}
