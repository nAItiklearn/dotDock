import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { setNativeApi, unavailableNativeApi } from "../../lib/native/api";
import { createMockNativeApi } from "../../lib/native/mock";
import { SEARCH_ENTRIES } from "../searchIndex";
import { StartupPage } from "./StartupPage";

afterEach(() => setNativeApi(null));

describe("Startup page", () => {
  it("offers the way back while the startup state is still being read", () => {
    setNativeApi(createMockNativeApi());
    const html = renderToStaticMarkup(<StartupPage />);
    // The gate is loading (no effects run on the server), yet the restore row is already there.
    expect(html).toContain("Reading from the app");
    expect(html).toContain("Restore Windows desktop");
  });

  it("hides the restore button in a plain browser, where it could only fail", () => {
    setNativeApi(unavailableNativeApi);
    const html = renderToStaticMarkup(<StartupPage />);
    expect(html).toContain("Available in the desktop app");
    expect(html).not.toContain("Restore Windows desktop");
  });

  it("has no second desktop switch beside the dotDock theme switch", () => {
    setNativeApi(createMockNativeApi());
    const html = renderToStaticMarkup(<StartupPage />);
    expect(html).not.toContain("Use this desktop");
    expect(SEARCH_ENTRIES.some((entry) => entry.id === "use-desktop")).toBe(false);
  });
});
