// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeApi } from "../../lib/native/api";
import { THEME_DESCRIPTION } from "./EnvironmentSwitches";

afterEach(() => {
  cleanup();
});

/** The switch shares one store per Settings window, so each test loads its own copy of the modules and the mock core. */
async function mount(): Promise<void> {
  vi.resetModules();
  const api = await import("../../lib/native/api");
  const { createMockNativeApi } = await import("../../lib/native/mock");
  const { EnvironmentSwitches } = await import("./EnvironmentSwitches");
  const native: NativeApi = createMockNativeApi();
  api.setNativeApi(native);
  render(<EnvironmentSwitches />);
}

describe("the switch at the end of Settings", () => {
  it("describes the whole environment, dock included, and the wallpaper that comes back is the user's own", () => {
    expect(THEME_DESCRIPTION).toMatch(/\bdock\b/i);
    expect(THEME_DESCRIPTION).toContain("your own wallpaper");
    expect(THEME_DESCRIPTION).toContain("picked while it was off");
  });

  it("is the only switch: there is no taskbar choice in this version", async () => {
    await mount();
    const theme = (await screen.findByRole("switch", { name: "dotDock theme" })) as HTMLButtonElement;
    await waitFor(() => expect(theme.disabled).toBe(false));
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    expect(screen.queryByText(/windows taskbar/i)).toBeNull();
    fireEvent.click(theme);
    await waitFor(() => expect(theme.getAttribute("aria-checked")).toBe("false"));
  });
});
