// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setNativeApi } from "../../lib/native/api";
import { createMockNativeApi } from "../../lib/native/mock";
import { EnvironmentSwitches, TASKBAR_WITHOUT_DOCK, THEME_DESCRIPTION } from "./EnvironmentSwitches";

afterEach(() => {
  cleanup();
  setNativeApi(null);
});

describe("the two switches at the end of Settings", () => {
  it("describe only what this build has: no dock in the theme, and the wallpaper that comes back is the user's own", () => {
    expect(THEME_DESCRIPTION).not.toMatch(/\bdock\b/i);
    expect(THEME_DESCRIPTION).toContain("your own wallpaper");
    expect(THEME_DESCRIPTION).toContain("picked while it was off");
  });

  it("say why the taskbar switch cannot move while nothing replaces the Windows taskbar", async () => {
    setNativeApi(createMockNativeApi());
    render(<EnvironmentSwitches />);
    const taskbar = await screen.findByRole("switch", { name: "Use the Windows taskbar" });
    const theme = screen.getByRole("switch", { name: "dotDock theme" }) as HTMLButtonElement;
    await waitFor(() => expect(theme.disabled).toBe(false));
    expect((taskbar as HTMLButtonElement).disabled).toBe(true);
    expect(taskbar.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(TASKBAR_WITHOUT_DOCK)).toBeTruthy();
  });
});
