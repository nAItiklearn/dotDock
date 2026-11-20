import { describe, expect, it } from "vitest";
import type { ModuleStatus } from "../lib/native/api";
import { MODULE_COPY, viewOf, withChoice } from "./modulesModel";

const status = (patch: Partial<ModuleStatus> & Pick<ModuleStatus, "id">): ModuleStatus => ({
  enabled: true,
  state: "running",
  requires: null,
  error: null,
  ...patch,
});

const BUILD_WITH_DOCK: readonly ModuleStatus[] = [
  status({ id: "home" }),
  status({ id: "dock" }),
  status({ id: "taskbar", enabled: false, state: "stopped", requires: "dock" }),
  status({ id: "notch" }),
];

describe("viewOf", () => {
  it("shows a running part as on and lets it be switched", () => {
    expect(viewOf(status({ id: "home" }), BUILD_WITH_DOCK)).toEqual({ chip: "On", canSwitch: true, note: null });
  });

  it("shows a part switched off as off, and lets it be switched on", () => {
    expect(viewOf(status({ id: "notch", enabled: false, state: "stopped" }), BUILD_WITH_DOCK)).toEqual({
      chip: "Off",
      canSwitch: true,
      note: null,
    });
  });

  it("will not offer a part this build does not have", () => {
    const view = viewOf(status({ id: "dock", enabled: false, state: "unavailable" }), BUILD_WITH_DOCK);
    expect(view.canSwitch).toBe(false);
    expect(view.chip).toBe("Not in this build");
  });

  it("explains why a part failed, in the core's own words, and still lets it be tried again", () => {
    const view = viewOf(status({ id: "notch", state: "failed", error: "No Claude Code folder was found." }), BUILD_WITH_DOCK);
    expect(view).toEqual({ chip: "Couldn't start", canSwitch: true, note: "No Claude Code folder was found." });
  });

  it("keeps the taskbar replacement locked until the dock is on, and says so", () => {
    const dockOff = [status({ id: "dock", enabled: false, state: "stopped" }), BUILD_WITH_DOCK[2] as ModuleStatus];
    expect(viewOf(BUILD_WITH_DOCK[2] as ModuleStatus, dockOff)).toEqual({
      chip: "Off",
      canSwitch: false,
      note: "Turn the dock on first.",
    });
    expect(viewOf(BUILD_WITH_DOCK[2] as ModuleStatus, BUILD_WITH_DOCK).canSwitch).toBe(true);
  });

  it("names the part a waiting one is waiting for", () => {
    const waiting = status({ id: "taskbar", state: "waiting", requires: "dock" });
    expect(viewOf(waiting, BUILD_WITH_DOCK).chip).toBe("Waiting for the dock");
  });
});

describe("withChoice", () => {
  it("moves one switch and leaves the rest", () => {
    const next = withChoice(BUILD_WITH_DOCK, "home", false);
    expect(next.map((m) => m.enabled)).toEqual([false, true, false, true]);
  });

  it("switches the taskbar replacement off with the dock, as the core does", () => {
    const on = BUILD_WITH_DOCK.map((m) => (m.id === "taskbar" ? { ...m, enabled: true, state: "running" as const } : m));
    expect(withChoice(on, "dock", false).find((m) => m.id === "taskbar")?.enabled).toBe(false);
  });

  it("does not touch the dock when the taskbar replacement goes off", () => {
    expect(withChoice(BUILD_WITH_DOCK, "taskbar", false).find((m) => m.id === "dock")?.enabled).toBe(true);
  });
});

describe("MODULE_COPY", () => {
  it("covers each part once, in start order, with distinct row ids", () => {
    expect(MODULE_COPY.map((c) => c.id)).toEqual(["home", "dock", "taskbar", "notch"]);
    expect(new Set(MODULE_COPY.map((c) => c.rowId)).size).toBe(MODULE_COPY.length);
  });
});
