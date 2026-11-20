import { useEffect, useRef, useState } from "react";
import noticesMarkdown from "../../../../../THIRD_PARTY_NOTICES.md?raw";
import { PRODUCT_NAME } from "../../lib/branding";
import { getNativeApi, type UpdateStatus } from "../../lib/native/api";
import { Button, Switch } from "../../lib/ui/controls";
import { PageHeader, Row, Section } from "../ui/layout";
import { parseNotices, splitInline, type InlinePart } from "../noticesText";
import { useAppInfo } from "../useAppInfo";

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

function UpdatesRow() {
  const native = getNativeApi();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (native.available) native.updater.status().then(setStatus, () => setFailed(true));
  }, [native]);

  const check = (): void => {
    if (checking) return;
    setChecking(true);
    setFailed(false);
    native.updater
      .check()
      .then(setStatus, () => setFailed(true))
      .finally(() => setChecking(false));
  };

  // The switch moves at once; the core's answer to the latest click then confirms it.
  const latestToggle = useRef(0);
  const setAutomatic = (enabled: boolean): void => {
    setStatus((current) => (current ? { ...current, enabled } : current));
    latestToggle.current += 1;
    const ticket = latestToggle.current;
    native.updater.setEnabled(enabled).then(
      (next) => ticket === latestToggle.current && setStatus(next),
      () => setFailed(true),
    );
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
        <Button icon="reset" disabled={!native.available || checking} onClick={check}>
          {checking ? "Checking…" : "Check now"}
        </Button>
      </Row>
      {native.available && status ? (
        <Row id="updates-auto" label="Check automatically" description="Contacts the update service once a day. Nothing else is sent.">
          <Switch checked={status.enabled} label="Check for updates automatically" onChange={setAutomatic} />
        </Row>
      ) : null}
    </>
  );
}

export function AboutPage() {
  const info = useAppInfo();
  const notices = parseNotices(noticesMarkdown);
  return (
    <>
      <PageHeader page="about" />
      <Section title={PRODUCT_NAME}>
        <Row id="version" label="Version" description={info ? `${info.build} on ${info.os}` : "Running in a browser preview"}>
          <span className="mono-path tabular">{info?.version ?? __APP_VERSION__}</span>
        </Row>
        <UpdatesRow />
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
