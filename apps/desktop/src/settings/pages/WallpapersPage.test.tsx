// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  setNativeApi,
  unavailableNativeApi,
  type DisplayInfo,
  type NativeApi,
  type WallpaperAssignment,
  type WallpaperFit,
  type WallpaperItem,
} from "../../lib/native/api";
import { WallpapersPage } from "./WallpapersPage";

/** A core with two displays, two bundled wallpapers and a picture the user imports. */
interface FakeCore {
  readonly api: NativeApi;
  readonly assigned: { monitorId: string; wallpaperId: string | null; fit: WallpaperFit }[];
  readonly removed: string[];
}

const display = (id: string, name: string, x: number): DisplayInfo => ({
  id,
  name,
  primary: x === 0,
  bounds: { x, y: 0, width: 1920, height: 1080 },
  workArea: { x, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
  refreshHz: 60,
});

const MEADOW: WallpaperItem = { id: "meadow-dots-dark", name: "Wind Meadow", source: "bundled", mode: "dark", accent: "#f2ee3a", thumbnailUrl: "/wallpaper-thumbs/meadow-dots-dark.jpg" };
const RING: WallpaperItem = { id: "paper-ring-light", name: "Paper Ring", source: "bundled", mode: "light", accent: "#e2363d", thumbnailUrl: "/wallpaper-thumbs/paper-ring-light.jpg" };
const MINE: WallpaperItem = { id: "imported-1", name: "Lake", source: "imported", mode: null, accent: null, thumbnailUrl: "http://dotdock-wallpaper.localhost/imported-1" };

function fakeCore(): FakeCore {
  let items: WallpaperItem[] = [MEADOW, RING];
  let assignments: WallpaperAssignment[] = [
    { monitorId: "D1", wallpaperId: "meadow-dots-dark", fit: "fill" },
    { monitorId: "D2", wallpaperId: null, fit: "fill" },
  ];
  const assigned: FakeCore["assigned"] = [];
  const removed: string[] = [];
  const api: NativeApi = {
    ...unavailableNativeApi,
    available: true,
    displays: { list: () => Promise.resolve([display("D1", "Built-in display", 0), display("D2", "External monitor", 1920)]) },
    wallpapers: {
      ...unavailableNativeApi.wallpapers,
      list: () => Promise.resolve(items),
      assignments: () => Promise.resolve(assignments),
      assign: (monitorId, wallpaperId, fit) => {
        assigned.push({ monitorId, wallpaperId, fit });
        assignments = assignments.map((a) => (monitorId === "all" || a.monitorId === monitorId ? { ...a, wallpaperId, fit } : a));
        return Promise.resolve(assignments);
      },
      importFile: () => {
        items = [...items, MINE];
        return Promise.resolve(MINE);
      },
      remove: (id) => {
        removed.push(id);
        items = items.filter((i) => i.id !== id);
        return Promise.resolve();
      },
    },
  };
  return { api, assigned, removed };
}

let core: FakeCore;
beforeEach(() => {
  core = fakeCore();
  setNativeApi(core.api);
});
afterEach(() => {
  cleanup();
  setNativeApi(null);
});

const card = (name: RegExp): HTMLElement => screen.getByRole("button", { name });

describe("Wallpapers page", () => {
  it("shows each wallpaper as its real picture, never a drawn stand-in", async () => {
    const { container } = render(<WallpapersPage />);
    await screen.findByText("Paper Ring");
    const thumbs = [...container.querySelectorAll<HTMLImageElement>("img.wallpaper__thumb")].map((img) => img.getAttribute("src"));
    expect(thumbs).toEqual([MEADOW.thumbnailUrl, RING.thumbnailUrl]);
    expect(container.innerHTML).not.toMatch(/gradient/i);
  });

  it("tells the dark and light takes apart", async () => {
    render(<WallpapersPage />);
    expect((await screen.findByRole("button", { name: /Wind Meadow\s*Dark/ })).getAttribute("aria-pressed")).toBe("true");
    expect(card(/Paper Ring\s*Light/).getAttribute("aria-pressed")).toBe("false");
  });

  it("applies a picked wallpaper to every screen, then marks it chosen", async () => {
    render(<WallpapersPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Paper Ring/ }));
    await waitFor(() => expect(core.assigned).toEqual([{ monitorId: "all", wallpaperId: "paper-ring-light", fit: "fill" }]));
    await waitFor(() => expect(card(/Paper Ring/).getAttribute("aria-pressed")).toBe("true"));
  });

  it("applies to one screen when one is chosen, with the fit mode", async () => {
    render(<WallpapersPage />);
    fireEvent.change(await screen.findByRole("combobox", { name: "Apply to" }), { target: { value: "D2" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Fit mode" }), { target: { value: "tile" } });
    await waitFor(() => expect(core.assigned.at(-1)).toEqual({ monitorId: "D2", wallpaperId: null, fit: "tile" }));
  });

  it("puts the original wallpaper back", async () => {
    render(<WallpapersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Original" }));
    await waitFor(() => expect(core.assigned.at(-1)?.wallpaperId).toBeNull());
  });

  it("imports a picture of your own into the library, and removes it again", async () => {
    render(<WallpapersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    expect(await screen.findByText("Lake")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove Lake" }));
    await waitFor(() => expect(core.removed).toEqual(["imported-1"]));
    await waitFor(() => expect(screen.queryByText("Lake")).toBeNull());
    // Bundled wallpapers cannot be removed.
    expect(screen.queryByRole("button", { name: "Remove Paper Ring" })).toBeNull();
  });
});
