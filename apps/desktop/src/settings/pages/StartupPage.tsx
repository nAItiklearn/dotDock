import { getApp } from "../../lib/state/app";
import type { StartupState, StartupToggle } from "../../lib/native/api";
import { getNativeApi } from "../../lib/native/api";
import { Switch } from "../../lib/ui/controls";
import { Icon } from "../../lib/ui/Icon";
import { EnvironmentSwitches } from "../ui/EnvironmentSwitches";
import { NativeGate, useNativeResource, type NativeResource } from "../ui/native";
import { PageHeader, Row, Section } from "../ui/layout";
import { pageById } from "../pageMeta";

function BootTiming({ boot }: { readonly boot: NonNullable<StartupState["lastBoot"]> }) {
  const total = boot.stages.reduce((sum, s) => sum + s.ms, 0);
  const longest = Math.max(1, ...boot.stages.map((s) => s.ms));
  return (
    <div className="row row--block" data-setting-id="boot-timing">
      <p className="row__desc">
        Last start, {new Date(boot.startedAt).toLocaleString()}. {total.toLocaleString()} ms from launch to widgets on screen.
      </p>
      <ul className="bars" aria-label="Start-up stages">
        {boot.stages.map((stage) => (
          <li key={stage.name} className="bars__row">
            <span className="bars__label">{stage.name}</span>
            <span className="bars__track" aria-hidden="true">
              <span className="bars__fill" style={{ width: `${(stage.ms / longest) * 100}%` }} />
            </span>
            <span className="bars__value tabular">{stage.ms.toLocaleString()} ms</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StartupBody({ resource, state }: { readonly resource: NativeResource<StartupState>; readonly state: StartupState }) {
  const change = (setting: StartupToggle, value: boolean): void => {
    getNativeApi()
      .startup.set(setting, value)
      .then(resource.set, (error: unknown) =>
        getApp().notices.getState().push({
          key: `native:${setting}`,
          level: "error",
          message: `That didn't change: ${error instanceof Error ? error.message : String(error)}`,
        }),
      );
  };
  return (
    <>
      {state.safeMode ? (
        <div className="banner" role="status">
          <Icon name="info" size={18} />
          <div>
            <strong>Safe mode.</strong> This session started without changing the desktop. Settings are available; the overlay and launch at sign-in are off.
          </div>
        </div>
      ) : null}
      <Section title="Desktop">
        <Row id="launch" label="Launch at sign-in" description="Starts with no delay, so the desktop is ready when Windows is.">
          <Switch checked={state.launchAtSignIn} label="Launch at sign-in" onChange={(v) => change("launchAtSignIn", v)} />
        </Row>
        <Row id="desktop-icons" label="Hide desktop icons" description="Hides the stock icons behind your widgets. They come back whenever you restore Windows.">
          <Switch checked={state.hideDesktopIcons} label="Hide desktop icons" onChange={(v) => change("hideDesktopIcons", v)} />
        </Row>
        <div className="row">
          <div className="row__text">
            <div className="row__label">Windows startup delay</div>
            <p className="row__desc">Windows normally waits about ten seconds before starting your apps.</p>
          </div>
          <span className="chip">{state.startupDelayRemoved ? "Removed" : "Windows default"}</span>
        </div>
      </Section>
      <Section title="Boot timing" description="How long the last start took, stage by stage.">
        {state.lastBoot ? (
          <BootTiming boot={state.lastBoot} />
        ) : (
          <div className="row row--block" data-setting-id="boot-timing">
            <p className="empty">
              <span className="caps">No timings yet</span>
              They appear after the app has started once with launch at sign-in on.
            </p>
          </div>
        )}
      </Section>
    </>
  );
}

export function StartupPage() {
  const resource = useNativeResource((api) => api.startup.get());
  const page = pageById("startup");
  return (
    <>
      <PageHeader title={page.title} description={page.description} />
      <NativeGate
        resource={resource}
        icon="power"
        offers={[
          "Start with Windows, with no startup delay.",
          "Hide the stock desktop icons behind your widgets.",
        ]}
      >
        {(state) => <StartupBody resource={resource} state={state} />}
      </NativeGate>
      {/* Outside the gate: the way back to Windows is the dotDock theme switch, reachable even when the startup state cannot be read. */}
      <EnvironmentSwitches />
    </>
  );
}
