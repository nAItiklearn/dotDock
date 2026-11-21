// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setNativeApi, unavailableNativeApi, type NativeApi } from "../../lib/native/api";
import { DEFAULT_DOCK_SETTINGS, DOCK_THEME_STORAGE_KEY, DOCK_THEMES, readDockTheme, type DockAppName, type DockSettings } from "../../lib/native/dock";
import { DockAppearancePage, DockBehaviourPage, DockItemsPage, DockTaskbarPage, DockTilesPage, magnificationText, PREVIEW_WALLPAPER } from "./DockPages";

/**
 * Every control on the Dock pages is checked for its real effect: what it hands the core's
 * `settings_dock_set` (the dock's own store, which a running dock applies at once), or, for the theme,
 * the storage key the dock window reads its theme from.
 */
interface FakeDock {
  readonly api: NativeApi;
  readonly writes: DockSettings[];
  current(): DockSettings;
}

const APPS: readonly DockAppName[] = [
  { id: "app.files", name: "Files" },
  { id: "app.browser", name: "Browser" },
  { id: "app.terminal", name: "Terminal" },
];

function fakeDock(start: DockSettings): FakeDock {
  let settings = start;
  const writes: DockSettings[] = [];
  const api: NativeApi = {
    ...unavailableNativeApi,
    available: true,
    dock: {
      get: () => Promise.resolve(settings),
      set: (next) => {
        writes.push(next);
        settings = next;
        return Promise.resolve(next);
      },
      apps: () => Promise.resolve(APPS),
    },
  };
  return { api, writes, current: () => settings };
}

const START: DockSettings = {
  ...DEFAULT_DOCK_SETTINGS,
  pinned: [
    { kind: "app", id: "app.files" },
    { kind: "app", id: "app.browser" },
  ],
  tiles: ["clock", "media"],
};

let dock: FakeDock;

beforeEach(() => {
  dock = fakeDock(START);
  setNativeApi(dock.api);
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  setNativeApi(null);
});

const lastWrite = async (): Promise<DockSettings> => {
  await waitFor(() => expect(dock.writes.length).toBeGreaterThan(0));
  return dock.writes[dock.writes.length - 1] as DockSettings;
};

describe("Dock / Items", () => {
  it("names the pinned apps from the dock's scan", async () => {
    render(<DockItemsPage />);
    expect(await screen.findByText("Files")).toBeTruthy();
    expect(screen.getByText("Browser")).toBeTruthy();
  });

  it("moves an app one place and writes the new order", async () => {
    render(<DockItemsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Move Files right" }));
    expect((await lastWrite()).pinned).toEqual([
      { kind: "app", id: "app.browser" },
      { kind: "app", id: "app.files" },
    ]);
  });

  it("removes an app from the dock", async () => {
    render(<DockItemsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Browser from the dock" }));
    expect((await lastWrite()).pinned).toEqual([{ kind: "app", id: "app.files" }]);
  });

  it("offers only apps not on the dock yet, and adds the picked one at the end", async () => {
    render(<DockItemsPage />);
    await screen.findByText("Files");
    const picker = await screen.findByRole("combobox", { name: "Keep an app on the dock" });
    const offered = Array.from((picker as HTMLSelectElement).options).map((o) => o.value);
    expect(offered).toEqual(["app.terminal"]);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect((await lastWrite()).pinned.at(-1)).toEqual({ kind: "app", id: "app.terminal" });
  });
});

describe("Dock / Tiles", () => {
  it("adds a tile at the end and removes one", async () => {
    render(<DockTilesPage />);
    const picker = await screen.findByRole("combobox", { name: "Add a tile" });
    const offered = Array.from((picker as HTMLSelectElement).options).map((o) => o.value);
    expect(offered).not.toContain("clock");
    expect(offered).not.toContain("media");
    fireEvent.change(picker, { target: { value: "battery" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect((await lastWrite()).tiles).toEqual(["clock", "media", "battery"]);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Clock from the dock" }));
    await waitFor(() => expect(dock.current().tiles).toEqual(["media", "battery"]));
  });
});

describe("Dock / Appearance", () => {
  it("shows every dock theme over the Wind Meadow wallpaper", () => {
    const { container } = render(<DockAppearancePage />);
    const previews = container.querySelectorAll<HTMLElement>(".dock-preview");
    expect(previews.length).toBe(DOCK_THEMES.length);
    previews.forEach((p) => expect(p.style.backgroundImage).toContain(PREVIEW_WALLPAPER));
    expect(container.querySelectorAll("[data-dock-theme]").length).toBe(DOCK_THEMES.length);
  });

  it("saves the picked theme where the dock window reads it", () => {
    render(<DockAppearancePage />);
    expect(screen.getByRole("radio", { name: /^Glasss*Blurs/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: /^Paper/ }));
    expect(localStorage.getItem(DOCK_THEME_STORAGE_KEY)).toBe("paper");
    expect(readDockTheme()).toBe("paper");
    expect(screen.getByRole("radio", { name: /^Paper/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("opens on the theme saved earlier", () => {
    localStorage.setItem(DOCK_THEME_STORAGE_KEY, "minimal");
    render(<DockAppearancePage />);
    expect(screen.getByRole("radio", { name: /^Minimal/ }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("Dock / Behaviour", () => {
  it("writes the icon size, clamped to what the dock draws", async () => {
    render(<DockBehaviourPage />);
    const slider = await screen.findByRole("slider", { name: "Icon size" });
    fireEvent.change(slider, { target: { value: "64" } });
    expect((await lastWrite()).iconSize).toBe(64);
  });

  it("writes magnification, and calls the lowest setting off", async () => {
    render(<DockBehaviourPage />);
    const slider = await screen.findByRole("slider", { name: "Magnification" });
    fireEvent.change(slider, { target: { value: "1" } });
    expect((await lastWrite()).magnification).toBe(1);
    expect(magnificationText(1)).toBe("Off");
    expect(magnificationText(1.6)).toBe("160%");
  });

  it("has no position control: the dock sits at the bottom only", async () => {
    render(<DockBehaviourPage />);
    await screen.findByRole("slider", { name: "Icon size" });
    expect(screen.queryByRole("radiogroup", { name: /position/i })).toBeNull();
    expect(screen.queryByText(/position on screen/i)).toBeNull();
  });

  it("turns auto-hide on", async () => {
    render(<DockBehaviourPage />);
    fireEvent.click(await screen.findByRole("switch", { name: "Hide the dock automatically" }));
    expect((await lastWrite()).autoHide).toBe(true);
  });

  it("puts a changed size back to the default with its reset", async () => {
    dock = fakeDock({ ...START, iconSize: 72 });
    setNativeApi(dock.api);
    render(<DockBehaviourPage />);
    await screen.findByRole("slider", { name: "Icon size" });
    const reset = screen.getAllByRole("button", { name: /reset/i })[0] as HTMLElement;
    await act(async () => fireEvent.click(reset));
    expect((await lastWrite()).iconSize).toBe(DEFAULT_DOCK_SETTINGS.iconSize);
  });
});

describe("Dock / Taskbar", () => {
  it("lets maximised windows go under the dock when keeping clear is off", async () => {
    render(<DockTaskbarPage />);
    fireEvent.click(await screen.findByRole("switch", { name: "Keep windows clear of the dock" }));
    expect((await lastWrite()).reserveSpace).toBe(false);
  });

  it("never edits the Windows taskbar choice itself; it links to the switch at the end of Settings", async () => {
    render(<DockTaskbarPage />);
    const link = await screen.findByRole("link", { name: "Open Recovery" });
    expect(link.getAttribute("href")).toContain("recovery");
    fireEvent.click(screen.getByRole("switch", { name: "Keep windows clear of the dock" }));
    const written = await lastWrite();
    expect(written.enabled).toBe(START.enabled);
    expect(written.replaceTaskbar).toBe(START.replaceTaskbar);
  });
});
