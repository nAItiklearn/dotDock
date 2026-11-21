// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentState, NativeApi } from "../../lib/native/api";
import { TASKBAR_SWITCH, TASKBAR_WITHOUT_DOCK, THEME_DESCRIPTION } from "./EnvironmentSwitches";

afterEach(() => {
  cleanup();
});

/**
 * The switches share one store per Settings window, so each test loads its own copy of the modules and hands it a
 * core: the mock, optionally answering `environment_get` with a given state.
 */
async function mount(environment?: EnvironmentState): Promise<void> {
  vi.resetModules();
  const api = await import("../../lib/native/api");
  const { createMockNativeApi } = await import("../../lib/native/mock");
  const { EnvironmentSwitches } = await import("./EnvironmentSwitches");
  const native: NativeApi = createMockNativeApi();
  api.setNativeApi(
    environment ? { ...native, environment: { ...native.environment, get: () => Promise.resolve(environment) } } : native,
  );
  render(<EnvironmentSwitches />);
}

describe("the two switches at the end of Settings", () => {
  it("describe the whole environment, dock included, and the wallpaper that comes back is the user's own", () => {
    expect(THEME_DESCRIPTION).toMatch(/\bdock\b/i);
    expect(THEME_DESCRIPTION).toContain("your own wallpaper");
    expect(THEME_DESCRIPTION).toContain("picked while it was off");
    expect(TASKBAR_SWITCH).toContain("hides the dotDock dock");
  });

  it("let the user give the taskbar back to Windows while the dock replaces it", async () => {
    await mount();
    const taskbar = (await screen.findByRole("switch", { name: "Use the Windows taskbar" })) as HTMLButtonElement;
    await waitFor(() => expect(taskbar.disabled).toBe(false));
    expect(taskbar.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(TASKBAR_SWITCH)).toBeTruthy();
    fireEvent.click(taskbar);
    await waitFor(() => expect(taskbar.getAttribute("aria-checked")).toBe("true"));
  });

  it("say why the taskbar switch cannot move while the dock did not start", async () => {
    await mount({ on: true, windowsTaskbar: true, taskbarReplacement: false, problems: [] });
    const taskbar = await screen.findByRole("switch", { name: "Use the Windows taskbar" });
    const theme = screen.getByRole("switch", { name: "dotDock theme" }) as HTMLButtonElement;
    await waitFor(() => expect(theme.disabled).toBe(false));
    expect((taskbar as HTMLButtonElement).disabled).toBe(true);
    expect(taskbar.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(TASKBAR_WITHOUT_DOCK)).toBeTruthy();
  });
});
