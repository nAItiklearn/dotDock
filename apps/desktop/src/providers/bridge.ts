import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useProviderStore } from "./store";
import type { ProviderIssue, ProviderName, ProviderPayloads } from "./types";

/** Event names emitted by the Rust core. Keep in sync with src-tauri/src/providers/mod.rs. */
const EVENT_DATA = "provider://data";
const EVENT_ISSUE = "provider://issue";

interface DataEvent<K extends ProviderName = ProviderName> {
  readonly provider: K;
  readonly data: ProviderPayloads[K];
}
interface IssueEvent {
  readonly provider: ProviderName;
  readonly issue: ProviderIssue;
}

export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

/** Connects providers to their live source. Returns a disposer. */
export async function connectProviders(): Promise<() => void> {
  const { publish, report } = useProviderStore.getState();

  if (isTauri()) {
    const offData = await listen<DataEvent>(EVENT_DATA, (e) => publish(e.payload.provider, e.payload.data));
    const offIssue = await listen<IssueEvent>(EVENT_ISSUE, (e) => report(e.payload.provider, e.payload.issue));
    // The weather provider is not built yet; say so honestly instead of "waiting".
    report("weather", "needs-setup");
    // Ask the core to replay current values now that listeners exist.
    await invoke("providers_ready");
    return () => {
      offData();
      offIssue();
    };
  }

  // Plain browser (design preview): only sources the browser can read for real.
  report("system", "unsupported");
  report("weather", "needs-setup");
  return connectBrowserBattery(publish, report);
}

interface BrowserBattery extends EventTarget {
  readonly level: number;
  readonly charging: boolean;
  readonly chargingTime: number;
  readonly dischargingTime: number;
}

async function connectBrowserBattery(
  publish: <K extends ProviderName>(name: K, data: ProviderPayloads[K]) => void,
  report: (name: ProviderName, issue: ProviderIssue) => void,
): Promise<() => void> {
  const nav = navigator as Navigator & { getBattery?: () => Promise<BrowserBattery> };
  if (!nav.getBattery) {
    report("battery", "unsupported");
    return () => undefined;
  }
  const battery = await nav.getBattery();
  const push = (): void => {
    const seconds = battery.charging ? battery.chargingTime : battery.dischargingTime;
    publish("battery", {
      percent: Math.round(battery.level * 100),
      charging: battery.charging,
      secondsRemaining: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
    });
  };
  push();
  const events = ["levelchange", "chargingchange", "chargingtimechange", "dischargingtimechange"];
  events.forEach((e) => battery.addEventListener(e, push));
  return () => events.forEach((e) => battery.removeEventListener(e, push));
}
