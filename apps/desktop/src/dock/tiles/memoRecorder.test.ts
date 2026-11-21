import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
const { liveBars, recordingIssue, startMemo, useMemos } = await import("./memoRecorder");

describe("the voice memo recorder", () => {
  it("needs a microphone API, a recorder and somewhere to keep the audio", () => {
    expect(recordingIssue({ mediaDevices: () => undefined, recorder: class {}, indexedDB: {} })).toBeNull();
    expect(recordingIssue({ mediaDevices: undefined, recorder: class {}, indexedDB: {} })).toBe("unsupported");
    expect(recordingIssue({ mediaDevices: () => undefined, recorder: undefined, indexedDB: {} })).toBe("unsupported");
    expect(recordingIssue({ mediaDevices: () => undefined, recorder: class {}, indexedDB: undefined })).toBe("unsupported");
  });

  it("reports this test runner, which cannot record, as unsupported and does not start", async () => {
    expect(useMemos.getState().issue).toBe("unsupported");
    await startMemo();
    expect(useMemos.getState().status).toBe("idle");
  });

  it("draws the newest readings on the face, silent before the recording began", () => {
    expect(liveBars([0.4])).toEqual([0, 0, 0, 0, 0.4]);
    expect(liveBars([0.1, 0.2, 0.3, 0.4, 0.5, 0.6])).toEqual([0.2, 0.3, 0.4, 0.5, 0.6]);
  });

  it("asks for the microphone once and reads a refusal as no device", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    useMemos.setState({ issue: null, status: "idle" });
    await startMemo();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(useMemos.getState()).toMatchObject({ status: "idle", issue: "no-device" });
    vi.unstubAllGlobals();
  });
});
