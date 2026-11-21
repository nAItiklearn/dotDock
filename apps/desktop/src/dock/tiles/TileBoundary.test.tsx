import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("window", { innerWidth: 1920, innerHeight: 1080, addEventListener: () => undefined, removeEventListener: () => undefined, matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }) });
vi.stubGlobal("document", { hidden: false, addEventListener: () => undefined, removeEventListener: () => undefined });
vi.stubGlobal("location", { search: "" });
vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });

const { TILE_RETRY_MS, TileBoundary, TileFallback } = await import("./TileBoundary");

describe("one tile failing", () => {
  it("is caught by its own boundary, which then draws the fallback", () => {
    expect(TileBoundary.getDerivedStateFromError()).toEqual({ failed: true });
    const boundary = new TileBoundary({ id: "sun", children: null });
    boundary.state = { failed: true };
    expect(renderToStaticMarkup(<>{boundary.render()}</>)).toContain("Sun, Could not read this");
  });

  it("draws the tile's own children while nothing has failed", () => {
    expect(renderToStaticMarkup(<TileBoundary id="sun">healthy</TileBoundary>)).toBe("healthy");
  });

  it("tries again on its own after a while, and stops trying once it is gone", () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const boundary = new TileBoundary({ id: "wind", children: null });
    const setState = vi.spyOn(boundary, "setState").mockImplementation(() => undefined);
    boundary.componentDidCatch(new Error("bad value"), { componentStack: "" });
    vi.advanceTimersByTime(TILE_RETRY_MS);
    expect(setState).toHaveBeenCalledWith({ failed: false });
    setState.mockClear();
    boundary.componentDidCatch(new Error("again"), { componentStack: "" });
    boundary.componentWillUnmount();
    vi.advanceTimersByTime(TILE_RETRY_MS);
    expect(setState).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("names the tile and says it could not be read", () => {
    const html = renderToStaticMarkup(<TileFallback id="currency" />);
    expect(html).toContain('data-state="issue"');
    expect(html).toContain("Currency, Could not read this");
  });
});
