import { useEffect, useState } from "react";
import { getNativeApi, type PerformanceSettings, type PerformanceStats } from "../../lib/native/api";
import { getApp } from "../../lib/state/app";
import { SelectField, Switch } from "../../lib/ui/controls";
import { NativeGate, useNativeResource, type NativeResource } from "../ui/native";
import { PageHeader, Row, Section } from "../ui/layout";
import { pageById } from "../pageMeta";

/** How often the live numbers refresh while this page is open. */
const STATS_POLL_MS = 2000;

const REFRESH_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "0.5", label: "Every 2 seconds" },
  { value: "1", label: "Every second" },
  { value: "2", label: "Twice a second" },
  { value: "5", label: "Five times a second" },
];

function useStats(): PerformanceStats | null {
  const [stats, setStats] = useState<PerformanceStats | null>(null);
  useEffect(() => {
    const native = getNativeApi();
    if (!native.available) return undefined;
    let alive = true;
    const read = (): void => {
      native.performance.stats().then(
        (next) => alive && setStats(next),
        () => undefined,
      );
    };
    read();
    const timer = setInterval(read, STATS_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return stats;
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt className="caps">{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}

function PerformanceBody({ resource, settings }: { readonly resource: NativeResource<PerformanceSettings>; readonly settings: PerformanceSettings }) {
  const stats = useStats();
  const change = (patch: Partial<PerformanceSettings>): void => {
    getNativeApi()
      .performance.set(patch)
      .then(resource.set, (error: unknown) =>
        getApp().notices.getState().push({
          key: "native:performance",
          level: "error",
          message: `That didn't change: ${error instanceof Error ? error.message : String(error)}`,
        }),
      );
  };
  return (
    <>
      <Section title="Pause rules" description="The desktop stops drawing, and uses no graphics power, while any of these is true.">
        <div className="row row--block" data-setting-id="pause-rules">
          <div className="rows-inline">
            <div className="row">
              <div className="row__text">
                <div className="row__label">A full-screen app or game is running</div>
                <p className="row__desc">Recommended. The overlay is hidden from the GPU until you leave.</p>
              </div>
              <Switch checked={settings.pauseOnFullscreen} label="Pause during full-screen apps" onChange={(pauseOnFullscreen) => change({ pauseOnFullscreen })} />
            </div>
            <div className="row">
              <div className="row__text">
                <div className="row__label">Battery saver is on</div>
                <p className="row__desc">Stops animation and refreshes to save charge.</p>
              </div>
              <Switch checked={settings.pauseOnBatterySaver} label="Pause on battery saver" onChange={(pauseOnBatterySaver) => change({ pauseOnBatterySaver })} />
            </div>
            <div className="row">
              <div className="row__text">
                <div className="row__label">The screen is locked or off</div>
                <p className="row__desc">Nothing to see, nothing to draw.</p>
              </div>
              <Switch checked={settings.pauseWhenLocked} label="Pause when the screen is locked" onChange={(pauseWhenLocked) => change({ pauseWhenLocked })} />
            </div>
          </div>
        </div>
      </Section>
      <Section title="Data">
        <Row id="refresh" label="System data refresh" description="How often memory, disk and CPU readings update. Slower saves a little power; the clock is unaffected.">
          <SelectField
            label="System data refresh"
            value={String(settings.systemRefreshHz)}
            options={REFRESH_OPTIONS}
            onChange={(hz) => change({ systemRefreshHz: Number(hz) })}
          />
        </Row>
      </Section>
      <Section title="Right now" description="Updates every couple of seconds while this page is open.">
        <div className="row row--block" data-setting-id="frame-stats">
          <dl className="facts facts--wide">
            <Stat label="Frame rate" value={stats?.overlayFps != null ? `${Math.round(stats.overlayFps)} fps` : "Idle"} />
            <Stat label="Slowest 5% of frames" value={stats?.frameP95Ms != null ? `${stats.frameP95Ms.toFixed(1)} ms` : "Idle"} />
            <Stat label="CPU" value={stats ? `${stats.cpuPercent.toFixed(1)}%` : "…"} />
            <Stat label="Memory" value={stats ? `${Math.round(stats.workingSetMb)} MB` : "…"} />
          </dl>
        </div>
      </Section>
    </>
  );
}

export function PerformancePage() {
  const resource = useNativeResource((api) => api.performance.get());
  const page = pageById("performance");
  return (
    <>
      <PageHeader title={page.title} description={page.description} />
      <NativeGate
        resource={resource}
        icon="gauge"
        offers={[
          "Pause the desktop during full-screen games, on battery saver, or when the screen is locked.",
          "Choose how often system readings refresh.",
          "Watch frame rate, CPU and memory use while you arrange things.",
        ]}
      >
        {(settings) => <PerformanceBody resource={resource} settings={settings} />}
      </NativeGate>
    </>
  );
}
