import { useState } from "react";
import { getApp } from "../../lib/state/app";
import type { RestoreReport, StartupState, StartupToggle } from "../../lib/native/api";
import { getNativeApi } from "../../lib/native/api";
import { Button, Segmented, Switch } from "../../lib/ui/controls";
import { Icon } from "../../lib/ui/Icon";
import { NativeGate, useNativeResource, type NativeResource } from "../ui/native";
import { PageHeader, Row, Section } from "../ui/layout";
import { pageById } from "../pageMeta";

const RESTORE_STEPS: readonly { readonly key: keyof RestoreReport; readonly done: string; readonly skipped: string }[] = [
  { key: "wallpaperRestored", done: "Original wallpaper put back", skipped: "Wallpaper was already the original" },
  { key: "desktopIconsShown", done: "Desktop icons shown", skipped: "Desktop icons were already shown" },
  { key: "autostartRemoved", done: "Launch at sign-in removed", skipped: "Launch at sign-in was already off" },
  { key: "startupDelayRestored", done: "Windows startup delay restored", skipped: "Startup delay was already Windows' own" },
];

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

function RestoreRow() {
  const [confirming, setConfirming] = useState(false);
  const [report, setReport] = useState<RestoreReport | null>(null);
  const [busy, setBusy] = useState(false);
  const run = (): void => {
    setBusy(true);
    getNativeApi()
      .startup.restoreWindows()
      .then(setReport, (error: unknown) =>
        getApp().notices.getState().push({
          key: "native:restore",
          level: "error",
          message: `Couldn't restore the Windows desktop: ${error instanceof Error ? error.message : String(error)}`,
        }),
      )
      .finally(() => {
        setBusy(false);
        setConfirming(false);
      });
  };
  return (
    <>
      <Row
        id="restore"
        label="Restore Windows desktop"
        description="Puts back your original wallpaper, shows desktop icons, removes launch at sign-in and closes the overlay. Your settings stay, so coming back takes one click."
      >
        {confirming ? (
          <span className="row__confirm">
            <Button variant="danger" icon="restore" disabled={busy} onClick={run}>
              {busy ? "Restoring…" : "Yes, restore"}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <Button variant="danger" icon="restore" onClick={() => setConfirming(true)}>
            Restore…
          </Button>
        )}
      </Row>
      {report ? (
        <div className="row row--block">
          <ul className="steps" aria-label="What was restored">
            {RESTORE_STEPS.map((step) => (
              <li key={step.key} className="steps__row">
                <Icon name="check" size={14} />
                {report[step.key] ? step.done : step.skipped}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
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
        <Row
          id="use-desktop"
          label="Use this desktop"
          description="Switching to the Windows desktop restores your wallpaper and icons and closes the overlay. Nothing is deleted."
        >
          <Segmented
            label="Which desktop"
            value={state.useOurDesktop ? "ours" : "windows"}
            options={[
              { value: "ours", label: "This one" },
              { value: "windows", label: "Windows" },
            ]}
            onChange={(next) => change("useOurDesktop", next === "ours")}
          />
        </Row>
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
      <Section title="Way back">
        <RestoreRow />
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
          "Choose between this desktop and the stock Windows one, and switch back in one click.",
          "Start with Windows, with no startup delay.",
          "Hide the stock desktop icons behind your widgets.",
          "Restore the original wallpaper and icons if anything ever looks wrong.",
        ]}
      >
        {(state) => <StartupBody resource={resource} state={state} />}
      </NativeGate>
    </>
  );
}
