import { describe, expect, it, vi } from "vitest";
import type { TileFeeds } from "./ui-types";

vi.stubGlobal("window", { addEventListener: () => undefined, removeEventListener: () => undefined });
vi.stubGlobal("location", { search: "" });
vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
const { frameBatcher, useFeedStore } = await import("./feeds");

const network = (down: number): Partial<TileFeeds> => ({ network: { data: { downBytesPerSec: down, upBytesPerSec: 1 }, issue: null } });
const toggles: Partial<TileFeeds> = { toggles: { data: { switches: { wifi: true, bluetooth: false, nightLight: false, doNotDisturb: false }, brightness: 0.5 }, issue: null } };

describe("feed deliveries", () => {
  it("reach the store once per frame, the latest value of each feed winning", () => {
    const frames: (() => void)[] = [];
    const apply = vi.fn();
    const deliver = frameBatcher(apply, (flush) => frames.push(flush));
    deliver(network(1));
    deliver(toggles);
    deliver(network(2));
    expect(apply).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    frames[0]?.();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]?.[0]).toEqual({ ...network(2), ...toggles });
    deliver(network(3));
    expect(frames).toHaveLength(2);
  });

  it("leave untouched feeds as they were, so their tiles do not render again", () => {
    useFeedStore.getState().merge({ ...network(1), ...toggles });
    const before = useFeedStore.getState().feeds.toggles;
    useFeedStore.getState().merge(network(5));
    expect(useFeedStore.getState().feeds.toggles).toBe(before);
    expect(useFeedStore.getState().feeds.network?.data?.downBytesPerSec).toBe(5);
  });
});
