import { useEffect, useState } from "react";
import noticesMarkdown from "../../../../../THIRD_PARTY_NOTICES.md?raw";
import { PRODUCT_NAME } from "../../lib/branding";
import { getNativeApi, type UpdateStatus } from "../../lib/native/api";
import { Button } from "../../lib/ui/controls";
import { PageHeader, Row, Section } from "../ui/layout";
import { parseNotices, splitInline, type InlinePart } from "../noticesText";
import { updateView } from "../updateText";
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
  const [busy, setBusy] = useState(false);
  const [callFailed, setCallFailed] = useState(false);

  useEffect(() => {
    if (native.available) native.updater.status().then(setStatus, () => setCallFailed(true));
  }, [native]);

  const run = (task: () => Promise<void>): void => {
    setBusy(true);
    setCallFailed(false);
    task()
      .catch(() => setCallFailed(true))
      .finally(() => setBusy(false));
  };
  const check = (): void => run(() => native.updater.check().then(setStatus));
  const install = (): void => run(() => native.updater.install());

  const view = updateView({ native: native.available, status, callFailed, formatTime: (ms) => new Date(ms).toLocaleString() });

  return view.kind === "available" ? (
    <Row id="updates" label="Update available" description={view.line}>
      <Button icon="check" disabled={busy} onClick={install}>
        {busy ? "Installing…" : `Install ${view.version}`}
      </Button>
    </Row>
  ) : (
    <Row id="updates" label="Check for updates" description={view.line}>
      <Button icon="reset" disabled={!native.available || busy} onClick={check}>
        {busy ? "Checking…" : "Check now"}
      </Button>
    </Row>
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
