import { useCallback, useEffect, useState } from "react";
import { parseBackup, serializeBackup, type BackupBundle } from "../../lib/model/backup";
import { APP_NAME } from "../../lib/branding";
import { getNativeApi } from "../../lib/native/api";
import { getApp } from "../../lib/state/app";
import { Button } from "../../lib/ui/controls";
import { downloadText, pickTextFile } from "../ui/download";
import { PageHeader, Row, Section } from "../ui/layout";
import { offerUndo } from "../ui/undo";
import { pageById } from "../pageMeta";

/** The prefix the provider store uses for its last-known-value cache (src/providers/store.ts). */
const PROVIDER_CACHE_PREFIX = "dotdock.cache.";
const BYTES_PER_KB = 1024;

interface StoredFile {
  readonly name: string;
  readonly bytes: number;
}

function formatBytes(bytes: number): string {
  return bytes < BYTES_PER_KB ? `${bytes} B` : `${(bytes / BYTES_PER_KB).toFixed(1)} KB`;
}

function cacheKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key?.startsWith(PROVIDER_CACHE_PREFIX)) keys.push(key);
  }
  return keys;
}

function useStoredFiles(): { readonly files: readonly StoredFile[]; readonly location: string } {
  const app = getApp();
  const [files, setFiles] = useState<readonly StoredFile[]>([]);
  const [location, setLocation] = useState("This browser's local storage");

  useEffect(() => {
    const load = async (): Promise<void> => {
      const names = await app.backend.list("");
      const sized = await Promise.all(names.map(async (name) => ({ name, bytes: (await app.backend.read(name))?.length ?? 0 })));
      setFiles(sized);
    };
    void load();
    const stop = app.backend.watch(() => void load());
    const native = getNativeApi();
    if (native.available) native.app.info().then((info) => setLocation(info.dataDir), () => undefined);
    return stop;
  }, [app]);

  return { files, location };
}

function ExportRow() {
  const app = getApp();
  const [busy, setBusy] = useState(false);
  const run = (): void => {
    setBusy(true);
    void app.settings
      .getState()
      .exportBundle({ name: APP_NAME, version: __APP_VERSION__ })
      .then((bundle) => downloadText(`${APP_NAME.toLowerCase()}-backup-${new Date().toISOString().slice(0, 10)}.json`, serializeBackup(bundle)))
      .finally(() => setBusy(false));
  };
  return (
    <Row id="export" label="Export everything" description="Settings, every profile's layout and your themes in one file you can keep or move to another PC.">
      <Button icon="download" onClick={run} disabled={busy}>
        Export
      </Button>
    </Row>
  );
}

interface PendingImport {
  readonly name: string;
  readonly bundle: BackupBundle;
  readonly skipped: readonly string[];
}

function ImportRow() {
  const app = getApp();
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = (): void => {
    void pickTextFile(".json,application/json").then((file) => {
      if (!file) return;
      const result = parseBackup(file.text);
      if (result.ok) {
        setError(null);
        setPending({ name: file.name, bundle: result.bundle, skipped: result.skipped });
      } else {
        setPending(null);
        setError(result.errors.join(" "));
      }
    });
  };

  const apply = (): void => {
    if (!pending) return;
    const { bundle } = pending;
    void (async () => {
      const previous = await app.settings.getState().exportBundle({ name: APP_NAME, version: __APP_VERSION__ });
      await app.settings.getState().applyBundle(bundle);
      setPending(null);
      offerUndo("Backup imported.", () => app.settings.getState().applyBundle(previous));
    })();
  };

  return (
    <>
      <Row id="import" label="Import a backup" description="Replaces your current settings, layouts and themes with the ones in a backup file. You can undo it straight after.">
        <Button icon="upload" onClick={choose}>
          Choose file
        </Button>
      </Row>
      {error ? (
        <div className="row row--block">
          <div className="banner banner--error" role="alert">
            <strong>Can't import that file.</strong> {error}
          </div>
        </div>
      ) : null}
      {pending ? (
        <div className="row row--block">
          <div className="banner" role="group" aria-label="Import preview">
            <div>
              <strong>{pending.name}</strong>
              <p className="banner__detail">
                {pending.bundle.settings.profiles.length} profiles, {pending.bundle.themes.length} custom themes
                {pending.bundle.createdAt ? `, made ${new Date(pending.bundle.createdAt).toLocaleDateString()}` : ""}.
              </p>
              {pending.skipped.length > 0 ? (
                <ul className="banner__list">
                  {pending.skipped.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="banner__actions">
              <Button variant="primary" onClick={apply}>
                Replace my settings
              </Button>
              <Button variant="ghost" onClick={() => setPending(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ResetRow() {
  const app = getApp();
  const [confirming, setConfirming] = useState(false);
  const reset = (): void => {
    void (async () => {
      const previous = await app.settings.getState().exportBundle({ name: APP_NAME, version: __APP_VERSION__ });
      await app.settings.getState().resetAll();
      setConfirming(false);
      offerUndo("Everything is back to how it shipped.", () => app.settings.getState().applyBundle(previous));
    })();
  };
  return (
    <Row id="reset" label="Reset everything" description="Back to the shipped themes, profiles, layouts and hotkeys. Your custom themes and edited layouts are removed.">
      {confirming ? (
        <span className="row__confirm">
          <Button variant="danger" icon="trash" onClick={reset}>
            Yes, reset
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Keep my settings
          </Button>
        </span>
      ) : (
        <Button variant="danger" icon="reset" onClick={() => setConfirming(true)}>
          Reset…
        </Button>
      )}
    </Row>
  );
}

function CacheRow() {
  const [count, setCount] = useState(() => cacheKeys().length);
  const clear = useCallback(() => {
    cacheKeys().forEach((key) => window.localStorage.removeItem(key));
    setCount(0);
  }, []);
  return (
    <Row
      id="cache"
      label="Cached data"
      description={`The last battery, memory and weather readings, kept so widgets show real numbers the moment the desktop appears. ${count === 0 ? "Nothing is cached right now." : "They refill on their own."}`}
    >
      <Button icon="trash" onClick={clear} disabled={count === 0}>
        Delete cache
      </Button>
    </Row>
  );
}

export function DataPage() {
  const { files, location } = useStoredFiles();
  const total = files.reduce((sum, f) => sum + f.bytes, 0);
  const page = pageById("data");
  return (
    <>
      <PageHeader title={page.title} description={page.description} />
      <Section title="Stored on this PC" description={`${files.length} files, ${formatBytes(total)}.`}>
        <div className="row row--block" data-setting-id="stored">
          <p className="row__desc">
            <span className="caps">Location</span> <span className="mono-path">{location}</span>
          </p>
          <table className="files">
            <caption className="sr-only">Files stored by the app</caption>
            <tbody>
              {files.map((f) => (
                <tr key={f.name}>
                  <th scope="row">{f.name}</th>
                  <td className="tabular">{formatBytes(f.bytes)}</td>
                </tr>
              ))}
              {files.length === 0 ? (
                <tr>
                  <td colSpan={2} className="files__empty">
                    Nothing saved yet. Files appear here once you change a setting.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <CacheRow />
      </Section>

      <Section title="Back up and restore">
        <ExportRow />
        <ImportRow />
        <ResetRow />
      </Section>

      <Section title="Privacy">
        <div className="row row--block" data-setting-id="network">
          <p className="prose">
            Everything stays on this PC. There are no accounts, no analytics and no crash uploads.
          </p>
          <p className="prose">
            The app makes two kinds of network request, and only these: weather from Open-Meteo, only while a Weather widget is on your desktop; and a check for
            a newer version, which you can switch off under About.
          </p>
        </div>
      </Section>
    </>
  );
}
