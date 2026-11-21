import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaData, ProviderState } from "../providers/types";
import { activeSession } from "./mediaSession";

const invoke = vi.hoisted(() => vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(() => Promise.resolve(true)));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../providers/bridge", () => ({ isTauri: () => true }));
const { sendMediaCommand } = await import("./mediaControls");

const track: MediaData = {
  title: "Night Drive",
  artist: "Lumen",
  album: "Late",
  artwork: null,
  positionSec: 30,
  durationSec: 200,
  playing: true,
  canSeek: true,
  canNext: true,
  canPrev: true,
};
const live = (over: Partial<ProviderState<MediaData>> = {}): ProviderState<MediaData> => ({ data: track, stale: false, issue: null, ...over });

describe("which session the music widget shows", () => {
  it("shows the live session, playing or paused", () => {
    expect(activeSession(live())).toBe(track);
    const paused = { ...track, playing: false };
    expect(activeSession(live({ data: paused }))).toBe(paused);
  });

  it("drops the last track once the player closes: no dead play button", () => {
    expect(activeSession(live({ issue: "no-device" }))).toBeNull();
  });

  it("never shows remembered media from a previous run as if it were playing", () => {
    expect(activeSession(live({ stale: true }))).toBeNull();
  });

  it("shows nothing before the first reading", () => {
    expect(activeSession(live({ data: null }))).toBeNull();
  });
});

describe("transport commands reach the core in the shape it parses", () => {
  beforeEach(() => invoke.mockClear());

  it.each([
    [{ action: "toggle" }],
    [{ action: "next" }],
    [{ action: "previous" }],
    [{ action: "seek", positionSec: 42.5 }],
  ] as const)("%o", (command) => {
    sendMediaCommand(command);
    // Matches MediaCommand in shell/src/providers/media.rs (tag "action", kebab-case, positionSec).
    expect(invoke).toHaveBeenCalledWith("media_command", { command });
  });
});
