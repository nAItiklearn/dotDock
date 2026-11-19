/**
 * Wire protocol between the Rust `dotdock-island` crate / the Tauri core and the island window.
 * This file is the source of truth for the TypeScript side; the Rust structs live in
 * `src-tauri/island/src/{view,settings,connect}.rs` and use `serde(rename_all = "camelCase")`.
 */

/** What an agent session is doing right now. `idle` never appears in a snapshot (idle sessions are not shown). */
export type Phase =
  | "idle"
  | "thinking"
  | "reading"
  | "searching"
  | "editing"
  | "running"
  | "waiting"
  | "done"
  | "paused"
  | "limit"
  | "error"
  | "stopped";

export type AgentKind = "claude" | "codex";

/** Phases that mean "the turn is over"; they linger for a few seconds and then collapse. */
export const TERMINAL_PHASES: ReadonlySet<Phase> = new Set(["done", "paused", "limit", "error", "stopped"]);

export type ProblemKind = "usage_limit" | "login" | "connection" | "overloaded" | "model" | "api";

export interface Problem {
  readonly kind: ProblemKind;
  /** Short raw text from the agent, already trimmed (for example "Session limit"). */
  readonly message: string;
  /** Reset time as the agent printed it (for example "1:50pm"), when it gave one. */
  readonly resets: string | null;
}

export interface SessionView {
  readonly id: string;
  readonly agent: AgentKind;
  readonly phase: Phase;
  /** Tool name as the agent reports it (Read, Bash, apply_patch ...). */
  readonly tool: string | null;
  /** File name, search pattern, command description or URL the tool is working on. */
  readonly detail: string | null;
  readonly project: string;
  readonly title: string | null;
  /** First line of the final reply, set when `phase` is `done`. */
  readonly summary: string | null;
  /** Set when `phase` is `limit` or `error`. */
  readonly problem: Problem | null;
  /** Output tokens produced in the current turn. Real numbers read from the transcript, never estimated. */
  readonly tokensOut: number;
  /** Size of the context window in use after the latest reply, when known. */
  readonly contextTokens: number | null;
  /** Epoch milliseconds when the current turn started, null when unknown. */
  readonly turnStartedAt: number | null;
  /** Epoch milliseconds of the last change. */
  readonly updatedAt: number;
  /** Epoch milliseconds when a terminal phase collapses. Null while the agent is working. */
  readonly collapseAt: number | null;
}

export interface Snapshot {
  /** Increases with every published snapshot. */
  readonly seq: number;
  /** Visible sessions, oldest turn first. Empty when nothing is happening. */
  readonly sessions: readonly SessionView[];
  /** Session the island should show unless the user picked another one. */
  readonly current: string | null;
}

export type IconStyle = "dots" | "blocks" | "stripes";
export type IdleMode = "tiny" | "hidden";

export interface IslandSettings {
  readonly schema: 1;
  readonly enabled: boolean;
  /** What the island does when nothing is running. */
  readonly idle: IdleMode;
  /** 0.8 to 1.4 */
  readonly scale: number;
  /** Gap between the screen edge and the island in px, 0 to 64. */
  readonly topOffset: number;
  readonly iconStyle: IconStyle;
  readonly showDetail: boolean;
  readonly showTokens: boolean;
  readonly showElapsed: boolean;
  readonly showProject: boolean;
  /** The beetle and its landscape strip along the bottom edge. */
  readonly showScene: boolean;
  /** Slide out of the way while the cursor is over the island. */
  readonly moveAside: boolean;
  /** Move to another monitor when the cursor touches its top edge. */
  readonly followCursor: boolean;
  /** Also show Codex tasks (reads its local session logs). */
  readonly codex: boolean;
  readonly notify: boolean;
  readonly sound: boolean;
  /** 0 to 1 */
  readonly volume: number;
  /** Seconds a finished task stays visible, 2 to 30. */
  readonly doneLingerSecs: number;
}

export const DEFAULT_SETTINGS: IslandSettings = {
  schema: 1,
  enabled: true,
  idle: "tiny",
  scale: 1,
  topOffset: 10,
  iconStyle: "dots",
  showDetail: true,
  showTokens: true,
  showElapsed: false,
  showProject: false,
  showScene: true,
  moveAside: true,
  followCursor: true,
  codex: true,
  notify: true,
  sound: true,
  volume: 0.5,
  doneLingerSecs: 6,
};

export type ConnectionState = "no-claude" | "disconnected" | "connected" | "outdated" | "hook-missing";

export interface ConnectionStatus {
  readonly state: ConnectionState;
  /** Absolute path of the Claude Code user settings file that Connect edits. */
  readonly settingsPath: string;
  readonly codexAvailable: boolean;
}

export type FocusOutcome = "focused" | "window-not-found" | "session-ended";

/** Rectangle in CSS pixels, relative to the island window's client area. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Where the cursor may interact with the island window.
 * - `interactive`: the window accepts clicks here; everywhere else clicks pass through to the desktop.
 * - `hover`: the footprint whose enter/leave is reported through `island://pointer`, even while click-through.
 */
export interface Regions {
  readonly interactive: readonly Rect[];
  readonly hover: Rect | null;
}

/** Everything the window needs on first paint. */
export interface InitialState {
  readonly snapshot: Snapshot;
  readonly settings: IslandSettings;
  readonly connection: ConnectionStatus;
}

export interface PointerEvent {
  readonly inside: boolean;
}

/** Events emitted by Rust. */
export const EVENT_SNAPSHOT = "island://snapshot";
export const EVENT_SETTINGS = "island://settings";
export const EVENT_POINTER = "island://pointer";

/** Commands handled by Rust. */
export const CMD = {
  ready: "island_ready",
  state: "island_state",
  setRegions: "island_set_regions",
  focus: "island_focus",
  dismiss: "island_dismiss",
  connect: "island_connect",
  disconnect: "island_disconnect",
  connection: "island_connection",
  setSettings: "island_set_settings",
} as const;

/** Island window size in logical pixels. The island body is laid out inside it, centred at the top. */
export const WINDOW_SIZE = { width: 520, height: 240 } as const;
