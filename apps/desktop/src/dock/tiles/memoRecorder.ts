import { create } from "zustand";
import { addMemo, bars, FACE_BARS, loudness, MAX_MEMO_MS, MEMO_BARS, type MemoMeta } from "./memo";
import type { TileIssue } from "./ui-types";

/**
 * Records voice memos with the WebView's own microphone access and keeps them in this device's IndexedDB, next to the
 * dock's other local data. Nothing is uploaded. The live waveform is read from an analyser while recording only.
 */

const DB_NAME = "dotdock-memos";
const DB_VERSION = 1;
const AUDIO_STORE = "audio";
const META_KEY = "dotdock.dock.memos";
/** How often the live waveform takes a loudness reading while recording. */
const SAMPLE_EVERY_MS = 50;
const ANALYSER_SIZE = 1024;

export type RecorderStatus = "idle" | "starting" | "recording";

interface MemoState {
  readonly status: RecorderStatus;
  /** Why recording is not possible here, or null when it is. */
  readonly issue: TileIssue | null;
  readonly startedAt: number | null;
  /** The latest MEMO_BARS loudness readings of the recording in progress, 0 to 1. */
  readonly levels: readonly number[];
  readonly memos: readonly MemoMeta[];
  /** The memo being played back, if any. */
  readonly playing: string | null;
}

function readMeta(): MemoMeta[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(META_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(
      (m): m is MemoMeta =>
        typeof m === "object" &&
        m !== null &&
        typeof (m as MemoMeta).id === "string" &&
        Number.isFinite((m as MemoMeta).createdAt) &&
        Number.isFinite((m as MemoMeta).durationMs) &&
        Array.isArray((m as MemoMeta).peaks) &&
        (m as MemoMeta).peaks.every((v) => Number.isFinite(v)),
    );
  } catch {
    return [];
  }
}

function writeMeta(memos: readonly MemoMeta[]): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(memos));
  } catch {
    // Without storage the list lasts until the window closes.
  }
}

/** What this WebView lacks to record, or null when it has everything. */
export function recordingIssue(env: { readonly mediaDevices: unknown; readonly recorder: unknown; readonly indexedDB: unknown }): TileIssue | null {
  return env.mediaDevices && env.recorder && env.indexedDB ? null : "unsupported";
}

const environment = () => ({
  mediaDevices: typeof navigator !== "undefined" ? navigator.mediaDevices?.getUserMedia : undefined,
  recorder: typeof MediaRecorder !== "undefined" ? MediaRecorder : undefined,
  indexedDB: typeof indexedDB !== "undefined" ? indexedDB : undefined,
});

export const useMemos = create<MemoState>(() => ({
  status: "idle",
  issue: recordingIssue(environment()),
  startedAt: null,
  levels: [],
  memos: readMeta(),
  playing: null,
}));

/** The live bars for the tile's face: the most recent readings, newest on the right. */
export function liveBars(levels: readonly number[]): number[] {
  const tail = levels.slice(-FACE_BARS);
  return [...Array.from({ length: FACE_BARS - tail.length }, () => 0), ...tail];
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(AUDIO_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("could not open the memo store"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = act(db.transaction(AUDIO_STORE, mode).objectStore(AUDIO_STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("memo store request failed"));
    });
  } finally {
    db.close();
  }
}

interface Session {
  readonly stream: MediaStream;
  readonly recorder: MediaRecorder;
  readonly context: AudioContext;
  readonly timer: ReturnType<typeof setInterval>;
  readonly limit: ReturnType<typeof setTimeout>;
  readonly chunks: Blob[];
  /** Every loudness reading of this recording; only the tail is published, so nothing is copied per reading. */
  readonly levels: number[];
  /** Resolves once the recorder has stopped, however it stopped. */
  readonly stopped: Promise<void>;
}

let session: Session | null = null;
/** Set by Stop while the microphone is still being opened: the recording is dropped as soon as it would start. */
let cancelled = false;
let player: { readonly id: string; readonly audio: HTMLAudioElement | null } | null = null;

function release(stream: MediaStream, context: AudioContext | null): void {
  stream.getTracks().forEach((track) => track.stop());
  void context?.close().catch(() => undefined);
}

/** Starts recording; the browser asks for the microphone the first time. A refusal reads as "no device". */
export async function startMemo(): Promise<void> {
  const state = useMemos.getState();
  if (state.status !== "idle" || state.issue === "unsupported") return;
  cancelled = false;
  useMemos.setState({ status: "starting", levels: [] });
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    useMemos.setState({ status: "idle", issue: "no-device" });
    return;
  }
  if (cancelled) {
    release(stream, null);
    useMemos.setState({ status: "idle" });
    return;
  }
  let context: AudioContext | null = null;
  try {
    context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = ANALYSER_SIZE;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    const levels: number[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => resolve();
    });
    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      levels.push(loudness(samples));
      useMemos.setState({ levels: levels.slice(-MEMO_BARS) });
    }, SAMPLE_EVERY_MS);
    const limit = setTimeout(() => void stopMemo(), MAX_MEMO_MS);
    session = { stream, recorder, context, timer, limit, chunks, levels, stopped };
    // A microphone unplugged mid-memo ends the recording; what was recorded is kept, as if Stop was pressed.
    void stopped.then(() => {
      if (session?.recorder === recorder) void stopMemo();
    });
    recorder.start();
    useMemos.setState({ status: "recording", issue: null, startedAt: Date.now() });
  } catch {
    session = null;
    release(stream, context);
    useMemos.setState({ status: "idle", startedAt: null, levels: [], issue: "error" });
  }
}

/** Stops recording and keeps the memo: its audio in IndexedDB, its waveform and length in the list. */
export async function stopMemo(): Promise<void> {
  if (useMemos.getState().status === "starting") {
    cancelled = true;
    return;
  }
  const current = session;
  const { startedAt } = useMemos.getState();
  if (!current || startedAt === null) return;
  session = null;
  clearInterval(current.timer);
  clearTimeout(current.limit);
  if (current.recorder.state !== "inactive") current.recorder.stop();
  await current.stopped;
  release(current.stream, current.context);
  const memo: MemoMeta = { id: `memo-${startedAt}`, createdAt: startedAt, durationMs: Date.now() - startedAt, peaks: bars(current.levels, MEMO_BARS) };
  const blob = new Blob(current.chunks, { type: current.recorder.mimeType });
  try {
    await withStore("readwrite", (store) => store.put(blob, memo.id));
  } catch {
    useMemos.setState({ status: "idle", startedAt: null, levels: [], issue: "error" });
    return;
  }
  const { kept, dropped } = addMemo(useMemos.getState().memos, memo);
  await Promise.all(dropped.map((m) => withStore("readwrite", (store) => store.delete(m.id)).catch(() => undefined)));
  writeMeta(kept);
  useMemos.setState({ status: "idle", startedAt: null, levels: [], memos: kept });
}

function stopPlayback(): void {
  if (player?.audio) {
    player.audio.pause();
    URL.revokeObjectURL(player.audio.src);
  }
  player = null;
  useMemos.setState({ playing: null });
}

/** Plays a memo, or stops it when it is the one playing. A newer press always wins over a slower earlier one. */
export async function playMemo(id: string): Promise<void> {
  const same = player?.id === id;
  stopPlayback();
  if (same) return;
  const claim = { id, audio: null };
  player = claim;
  useMemos.setState({ playing: id });
  const blob = await withStore<Blob | undefined>("readonly", (store) => store.get(id) as IDBRequest<Blob | undefined>).catch(() => undefined);
  if (player !== claim) return;
  if (!blob) {
    player = null;
    useMemos.setState({ playing: null, issue: "error" });
    return;
  }
  const audio = new Audio(URL.createObjectURL(blob));
  const playing = { id, audio };
  player = playing;
  audio.onended = () => {
    if (player === playing) stopPlayback();
    else URL.revokeObjectURL(audio.src);
  };
  await audio.play().catch(() => {
    if (player === playing) stopPlayback();
  });
}

export async function deleteMemo(id: string): Promise<void> {
  if (player?.id === id) stopPlayback();
  await withStore("readwrite", (store) => store.delete(id)).catch(() => undefined);
  const memos = useMemos.getState().memos.filter((m) => m.id !== id);
  writeMeta(memos);
  useMemos.setState({ memos });
}
