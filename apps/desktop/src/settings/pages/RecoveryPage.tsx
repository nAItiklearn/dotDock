import { useState } from "react";
import { PRODUCT_NAME } from "../../lib/branding";
import { BACKUP_SCHEMA, LAYOUT_SCHEMA, SETTINGS_SCHEMA, THEME_SCHEMA } from "../../lib/model/types";
import { getNativeApi, type AppInfo, type RestoreReport, type StartupState } from "../../lib/native/api";
import { getApp } from "../../lib/state/app";
import { Button, Segmented } from "../../lib/ui/controls";
import { Icon } from "../../lib/ui/Icon";
import { NativeGate, useNativeResource, type NativeResource } from "../ui/native";
import { PageHeader, Row, Section } from "../ui/layout";
import { useAppInfo } from "../useAppInfo";
import { SafeModeBanner, useStartupChange } from "./StartupPage";

const COPIED_FLASH_MS = 2200;

const RESTORE_STEPS: readonly { readonly key: keyof RestoreReport; readonly done: string; readonly skipped: string }[] = [
  { key: "wallpaperRestored", done: "Original wallpaper put back", skipped: "Wallpaper was already the original" },
  { key: "desktopIconsShown", done: "Desktop icons shown", skipped: "Desktop icons were already shown" },
  { key: "autostartRemoved", done: "Launch at sign-in removed", skipped: "Launch at sign-in was already off" },
  { key: "startupDelayRestored", done: "Windows startup delay restored", skipped: "Startup delay was already Windows' own" },
];

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function RestoreRow() {
  const [confirming, setConfirming] = useState(false);
  const [report, setReport] = useState<RestoreReport | null>(null);
  const [busy, setBusy] = useState(false);
  const run = (): void => {
    if (busy) return;
    setBusy(true);
    getNativeApi()
      .startup.restoreWindows()
      .then(setReport, (error: unknown) =>
        getApp().notices.getState().push({ key: "native:restore", level: "error", message: `Couldn't restore the Windows desktop: ${message(error)}` }),
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
            <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
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

function DiagnosticsRow({ info }: { readonly info: AppInfo | null }) {
  const app = getApp();
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void (async () => {
      const { settings, customThemes } = app.settings.getState();
      const names = await app.backend.list("");
      const lines = [
        `${PRODUCT_NAME} ${__APP_VERSION__}`,
        `Schemas: settings ${SETTINGS_SCHEMA}, layout ${LAYOUT_SCHEMA}, theme ${THEME_SCHEMA}, backup ${BACKUP_SCHEMA}`,
        info ? `Core: ${info.version} (${info.build}) on ${info.os}, ${info.webview}` : "Core: not connected (browser preview)",
        `Browser: ${navigator.userAgent}`,
        `Screen: ${window.screen.width}x${window.screen.height} at ${window.devicePixelRatio}x`,
        `Profiles: ${settings.profiles.map((p) => p.name).join(", ")} (active: ${settings.activeProfileId})`,
        `Theme: ${settings.theme.mode}, ${customThemes.length} custom`,
        `Stored files: ${names.join(", ") || "none"}`,
      ];
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPIED_FLASH_MS);
    })().catch((error: unknown) =>
      app.notices.getState().push({ key: "diagnostics", level: "error", message: `Couldn't copy the report: ${message(error)}` }),
    );
  };
  return (
    <Row id="diagnostics" label="Diagnostics" description="Copies a short text report (versions, display, profile names) you can paste into a bug report. Nothing is sent anywhere.">
      <Button icon={copied ? "check" : "duplicate"} onClick={copy}>
        {copied ? "Copied" : "Copy diagnostics"}
      </Button>
    </Row>
  );
}

function LogsRow({ info }: { readonly info: AppInfo | null }) {
  const open = (): void => {
    getNativeApi()
      .app.openDataFolder()
      .catch((error: unknown) => getApp().notices.getState().push({ key: "native:open-folder", level: "error", message: `Couldn't open the folder: ${message(error)}` }));
  };
  return (
    <Row
      id="open-folder"
      label="Logs and data folder"
      description={info ? `${info.dataDir}. Holds boot.log, the panic log and your settings.` : "In the installed app this opens the folder with the logs and your settings."}
    >
      <Button icon="folder" disabled={!info} onClick={open}>
        Open folder
      </Button>
    </Row>
  );
}

/** The last section in Settings: the switch between this desktop and the stock one (SETTINGS_IA.md). */
function EnvironmentSection({ resource, state }: { readonly resource: NativeResource<StartupState>; readonly state: StartupState }) {
  const change = useStartupChange(resource);
  return (
    <Section title={`${PRODUCT_NAME} and Windows`}>
      <Row
        id="use-desktop"
        label="Use this desktop"
        description="Switching to the Windows desktop restores your wallpaper and icons and closes the overlay. Nothing is deleted."
      >
        <Segmented
          label="Which desktop"
          value={state.useOurDesktop ? "ours" : "windows"}
          options={[
            { value: "ours", label: PRODUCT_NAME },
            { value: "windows", label: "Windows" },
          ]}
          onChange={(next) => change("useOurDesktop", next === "ours")}
        />
      </Row>
    </Section>
  );
}

function RecoveryBody({ resource, state, info }: { readonly resource: NativeResource<StartupState>; readonly state: StartupState; readonly info: AppInfo | null }) {
  return (
    <>
      <SafeModeBanner state={state} />
      <Section title="Way back">
        <RestoreRow />
      </Section>
      <Section title="Logs">
        <LogsRow info={info} />
        <DiagnosticsRow info={info} />
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
      <EnvironmentSection resource={resource} state={state} />
    </>
  );
}

export function RecoveryPage() {
  const resource = useNativeResource((api) => api.startup.get());
  const info = useAppInfo();
  return (
    <>
      <PageHeader page="recovery" />
      <NativeGate
        resource={resource}
        icon="restore"
        offers={[
          "Restore the original wallpaper and icons if anything ever looks wrong.",
          "Open the folder with the logs, and copy a report for a bug.",
          "See how long the last start took, stage by stage.",
          "Choose between this desktop and the stock Windows one, and switch back in one click.",
        ]}
      >
        {(state) => <RecoveryBody resource={resource} state={state} info={info} />}
      </NativeGate>
    </>
  );
}
