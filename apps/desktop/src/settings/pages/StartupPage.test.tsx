import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { setNativeApi, unavailableNativeApi } from "../../lib/native/api";
import { createMockNativeApi } from "../../lib/native/mock";
import { SEARCH_ENTRIES } from "../searchIndex";
import { StartupPage } from "./StartupPage";

afterEach(() => setNativeApi(null));

describe("Startup page", () => {
  it("offers the way back, the dotDock theme switch, while the startup state is still being read", () => {
    setNativeApi(createMockNativeApi());
    const html = renderToStaticMarkup(<StartupPage />);
    // The gate is loading (no effects run on the server), yet the switch is already there.
    expect(html).toContain("Reading from the app");
    expect(html).toContain("dotDock theme");
  });

  it("has one way back: no second desktop switch and no separate restore button", () => {
    setNativeApi(createMockNativeApi());
    const html = renderToStaticMarkup(<StartupPage />);
    expect(html).not.toContain("Use this desktop");
    expect(html).not.toContain("Restore Windows desktop");
    expect(SEARCH_ENTRIES.some((entry) => entry.id === "use-desktop" || entry.id === "restore")).toBe(false);
  });

  it("finds the theme switch when someone searches for a way to restore Windows", () => {
    const hit = SEARCH_ENTRIES.find((entry) => entry.id === "environment-on");
    expect(hit?.keywords).toContain("restore");
    expect(hit?.keywords).toContain("panic");
  });

  it("explains what the page would do in a plain browser", () => {
    setNativeApi(unavailableNativeApi);
    const html = renderToStaticMarkup(<StartupPage />);
    expect(html).toContain("Available in the desktop app");
  });
});
