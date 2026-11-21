import { describe, expect, it } from "vitest";
import pkg from "../../package.json";
import tauriConf from "../../src-tauri/tauri.conf.json";
import type { UpdateStatus } from "../lib/native/api";
import { updateView } from "./updateText";

const LATEST_JSON = "https://github.com/nAItiklearn/dotDock/releases/latest/download/latest.json";
const CHECKED_AT = Date.UTC(2026, 10, 21);
const formatTime = (ms: number): string => new Date(ms).toISOString();
const status = (patch: Partial<UpdateStatus>): UpdateStatus => ({ checkedAtMs: null, available: null, failed: false, ...patch });

describe("release config", () => {
  it("keeps the app version in one place for the release tag check", () => {
    expect(tauriConf.version).toBe(pkg.version);
  });

  it("updates from the latest GitHub release, signed", () => {
    expect(tauriConf.plugins.updater.endpoints).toEqual([LATEST_JSON]);
    expect(tauriConf.plugins.updater.pubkey).not.toBe("");
    expect(tauriConf.bundle.createUpdaterArtifacts).toBe(true);
  });
});

describe("updateView", () => {
  const base = { native: true, callFailed: false, formatTime };

  it("explains that the browser preview cannot update", () => {
    expect(updateView({ ...base, native: false, status: null }).kind).toBe("preview");
  });

  it("starts unchecked until the one startup check has run", () => {
    expect(updateView({ ...base, status: status({}) }).kind).toBe("unchecked");
  });

  it("offers the newer version for install", () => {
    const view = updateView({ ...base, status: status({ checkedAtMs: CHECKED_AT, available: { version: "1.0.1", notes: null } }) });
    expect(view).toMatchObject({ kind: "available", version: "1.0.1" });
  });

  it("keeps a found update installable after a later failed check", () => {
    const view = updateView({ ...base, status: status({ failed: true, available: { version: "1.0.1", notes: null } }) });
    expect(view.kind).toBe("available");
  });

  it("reports an unreachable update service", () => {
    expect(updateView({ ...base, status: status({ failed: true }) }).kind).toBe("failed");
    expect(updateView({ ...base, callFailed: true, status: null }).kind).toBe("failed");
  });

  it("shows when it last confirmed the app is current", () => {
    const view = updateView({ ...base, status: status({ checkedAtMs: CHECKED_AT }) });
    expect(view).toEqual({ kind: "current", line: `Up to date. Last checked ${formatTime(CHECKED_AT)}.` });
  });
});
