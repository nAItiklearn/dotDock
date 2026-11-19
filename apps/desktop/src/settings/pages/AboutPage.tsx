import { useEffect, useState } from "react";
import noticesMarkdown from "../../../../../THIRD_PARTY_NOTICES.md?raw";
import { PRODUCT_NAME } from "../../lib/branding";
import { BACKUP_SCHEMA, LAYOUT_SCHEMA, SETTINGS_SCHEMA, THEME_SCHEMA } from "../../lib/model/types";
import { getNativeApi, type AppInfo, type UpdateStatus } from "../../lib/native/api";
import { getApp } from "../../lib/state/app";
import { useSettingsStore } from "../../lib/state/hooks";
import { Button, Switch } from "../../lib/ui/controls";
import { PageHeader, Row, Section } from "../ui/layout";
import { pageById } from "../pageMeta";
import { parseNotices, splitInline, type InlinePart } from "../noticesText";

const COPIED_FLASH_MS = 2200;
const OPEN_METEO_URL = "https://open-meteo.com/";

function Inline({ line }: { readonly line: string }) {
  return (
    <>
      {splitInline(line).map((part: InlinePart, i) =>
        part.kind === "link" ? (
          <a key={`${part.href}${i}`} href={part.href} target="_blank" rel="noopener noreferrer">
            {part.text}
          </a>
        ) : part.kind === "code" ? (
          <code key={`${part.text}${i}`}>{part.text}</code>
        ) : (
          <span key={`${part.text}${i}`}>{part.text}</span>
        ),
      )}
    </>
  );
}

function useAppInfo(): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    const native = getNativeApi();
    if (native.available) native.app.info().then(setInfo, () => setInfo(null));
  }, []);
  return info;
}

function UpdatesRow() {
  const native = getNativeApi();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (native.available) native.updater.status().then(setStatus, () => setFailed(true));
  }, [native]);

  const check = (): void => {
    setChecking(true);
    setFailed(false);
    native.updater
      .check()
      .then(setStatus, () => setFailed(true))
      .finally(() => setChecking(false));
  };

  const line = !native.available
    ? "Updates are delivered through the installed app."
    : failed
      ? "Couldn't reach the update service."
      : status?.available
        ? `Version ${status.available.version} is available.`
        : status?.checkedAt
          ? `Up to date. Last checked ${new Date(status.checkedAt).toLocaleString()}.`
          : "Not checked yet.";

  return (
    <>
      <Row id="updates" label="Check for updates" description={line}>
        <Button icon="reset" disabled={!native.available || checking || status?.enabled === false} onClick={check}>
          {checking ? "Checking…" : "Check now"}
        </Button>
      </Row>
      {native.available && status ? (
        <Row label="Check automatically" id="updates-auto" description="Contacts the update service once a day. Nothing else is sent." >
          <Switch
            checked={status.enabled}
            label="Check for updates automatically"
            onChange={(enabled) => void native.updater.setEnabled(enabled).then(setStatus, () => setFailed(true))}
          />
        </Row>
      ) : null}
    </>
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
      setTimeout(() => setCopied(false), COPIED_FLASH_MS);
    })();
  };
  return (
    <Row id="diagnostics" label="Diagnostics" description="Copies a short text report (versions, display, profile names) you can paste into a bug report. Nothing is sent anywhere.">
      <Button icon={copied ? "check" : "duplicate"} onClick={copy}>
        {copied ? "Copied" : "Copy diagnostics"}
      </Button>
    </Row>
  );
}

export function AboutPage() {
  const info = useAppInfo();
  const page = pageById("about");
  const notices = parseNotices(noticesMarkdown);
  const profiles = useSettingsStore((s) => s.settings.profiles.length);
  return (
    <>
      <PageHeader title={page.title} description={page.description} />
      <Section title={PRODUCT_NAME}>
        <Row id="version" label="Version" description={info ? `${info.build} on ${info.os}` : "Running in a browser preview"}>
          <span className="mono-path tabular">{info?.version ?? __APP_VERSION__}</span>
        </Row>
        <UpdatesRow />
        <DiagnosticsRow info={info} />
        <Row id="open-folder" label="Data folder" description={info ? info.dataDir : `${profiles} profiles in this browser's storage`}>
          <Button icon="folder" disabled={!info} onClick={() => void getNativeApi().app.openDataFolder()}>
            Open
          </Button>
        </Row>
      </Section>

      <Section title="Credits">
        <div className="row row--block" data-setting-id="attribution">
          <p className="prose">
            Weather data by{" "}
            <a href={OPEN_METEO_URL} target="_blank" rel="noopener noreferrer">
              Open-Meteo.com
            </a>{" "}
            (CC BY 4.0).
          </p>
          {notices.footer.map((line) => (
            <p key={line} className="prose">
              <Inline line={line} />
            </p>
          ))}
        </div>
      </Section>

      <Section title="Licences" description="Everything bundled with the app, and the licence it comes under.">
        <div className="row row--block" data-setting-id="licences">
          {notices.intro.map((line) => (
            <p key={line} className="prose">
              <Inline line={line} />
            </p>
          ))}
          {notices.sections.map((section) => (
            <div key={section.title} className="licence">
              <h3 className="licence__title caps">{section.title}</h3>
              <ul className="licence__list">
                {section.items.map((item) => (
                  <li key={item}>
                    <Inline line={item} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
