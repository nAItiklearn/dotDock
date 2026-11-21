import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { setNativeApi } from "../../lib/native/api";
import { createMockNativeApi } from "../../lib/native/mock";
import { SEARCH_ENTRIES } from "../searchIndex";
import { PAGES } from "../sections";
import { RecoveryPage } from "./RecoveryPage";

afterEach(() => setNativeApi(null));

describe("Recovery page", () => {
  it("ends Settings with the two low-key switches, the theme first, then the taskbar", () => {
    setNativeApi(createMockNativeApi());
    const html = renderToStaticMarkup(<RecoveryPage />);
    const theme = html.indexOf("dotDock theme");
    const taskbar = html.indexOf("Use the Windows taskbar");
    expect(theme).toBeGreaterThan(-1);
    expect(taskbar).toBeGreaterThan(theme);
  });

  it("is the last page of the last section, so the switches really are the end of Settings", () => {
    expect(PAGES[PAGES.length - 1]?.id).toBe("recovery");
  });

  it("has no second desktop switch beside the dotDock theme switch", () => {
    setNativeApi(createMockNativeApi());
    const html = renderToStaticMarkup(<RecoveryPage />);
    expect(html).not.toContain("Use this desktop");
    expect(SEARCH_ENTRIES.some((entry) => entry.id === "use-desktop")).toBe(false);
  });
});
