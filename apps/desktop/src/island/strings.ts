import type { ConnectionState, ProblemKind, SessionView } from "./protocol";

/** English copy. Every string the island shows lives here so a translation is one more dictionary. */
const EN = {
  "phase.thinking": "Thinking",
  "phase.reading": "Reading",
  "phase.searching": "Searching",
  "phase.editing": "Editing",
  "phase.running": "Running",
  "phase.waiting": "Needs you",
  "phase.done": "Done",
  "phase.paused": "Paused",
  "phase.limit": "Limit reached",
  "phase.stopped": "Stopped",
  "phase.idle": "Ready",

  "tool.write": "Writing",
  "tool.fetch": "Fetching",
  "tool.delegate": "Delegating",
  "tool.mcp": "Calling tool",

  "hint.waiting": "Approve in the terminal",
  "hint.paused": "Interrupted",
  "hint.stopped": "Session closed",
  "hint.limit.resets": "resets {when}",
  "hint.limit.plain": "Usage limit",

  "error.login": "Signed out",
  "error.login.hint.claude": "Run /login in the terminal",
  "error.login.hint.agent": "Sign in to {agent} again",
  "error.connection": "Offline",
  "error.connection.hint": "Check your connection and resend",
  "error.overloaded": "Busy",
  "error.overloaded.hint": "Server busy, resend in a moment",
  "error.model": "Model unavailable",
  "error.model.hint": "Pick another one in the terminal",
  "error.api": "API error",

  "flash.window-not-found": "No window",
  "flash.window-not-found.hint": "Could not find the terminal",
  "flash.session-ended": "Session ended",
  "flash.session-ended.hint": "Nothing to switch to",


  "aria.focus": "Show the terminal for {project}",
  "aria.standby": "No agent is running",
  "aria.pager": "Sessions",
  "aria.session": "Session {index} of {count}",
  "aria.tokens": "{count} output tokens this turn",
  "aria.elapsed": "{time} elapsed",

  "settings.title": "Agent Island",
  "settings.section.display": "Display",
  "settings.section.content": "Content",
  "settings.section.behaviour": "Behaviour",
  "settings.section.sound": "Notifications",
  "settings.section.connections": "Connections",
  "settings.enabled": "Show the island",
  "settings.idle": "When nothing is running",
  "settings.idle.tiny": "Tiny pill",
  "settings.idle.hidden": "Hidden",
  "settings.scale": "Size",
  "settings.topOffset": "Distance from the top edge",
  "settings.iconStyle": "Dot style",
  "settings.iconStyle.dots": "Dots",
  "settings.iconStyle.blocks": "Blocks",
  "settings.iconStyle.stripes": "Stripes",
  "settings.showDetail": "Current file or command",
  "settings.showTokens": "Tokens this turn",
  "settings.showElapsed": "Elapsed time",
  "settings.showProject": "Project name",
  "settings.showScene": "Creature and landscape",
  "settings.moveAside": "Move aside when the cursor is over it",
  "settings.followCursor": "Follow the cursor to other monitors",
  "settings.codex": "Also show Codex tasks",
  "settings.notify": "Notify when a task finishes",
  "settings.sound": "Play a sound when a task finishes",
  "settings.volume": "Volume",
  "settings.doneLinger": "Keep a finished task visible",
  "settings.reset": "Reset to defaults",
  "settings.unit.seconds": "{value} s",
  "settings.unit.px": "{value} px",
  "settings.unit.percent": "{value}%",

  "connection.state.connected": "Connected",
  "connection.state.disconnected": "Not connected",
  "connection.state.outdated": "Needs reconnecting",
  "connection.state.no-claude": "Claude Code not found",
  "connection.state.hook-missing": "Hook program missing",
  "connection.detail.connected": "The island reads Claude Code through hooks in your user settings.",
  "connection.detail.disconnected": "Connect adds the island's hooks to your Claude Code settings. Your other settings stay as they are.",
  "connection.detail.outdated": "The hooks point to an older location. Reconnect to repair them.",
  "connection.detail.no-claude": "Install Claude Code, then connect.",
  "connection.detail.hook-missing": "The hook program is not next to the app. Reinstall to restore it.",
  "connection.connect": "Connect",
  "connection.reconnect": "Reconnect",
  "connection.disconnect": "Disconnect",
  "connection.file": "Settings file",
  "connection.codex.found": "Codex logs found",
  "connection.codex.missing": "Codex not found",
  "connection.feed": "Other agents",
  "connection.feed.hint": "Any agent can report to this folder. See docs/ISLAND_PROTOCOL.md.",

  "agent.copilot": "GitHub Copilot CLI",
  "agent.opencode": "OpenCode",
  "agent.state.not-found": "Not found",
  "agent.state.disconnected": "Not connected",
  "agent.state.connected": "Connected",
  "agent.state.outdated": "Needs reconnecting",
  "agent.state.hook-missing": "Hook program missing",
  "agent.detail.copilot": "Connect adds one hooks file to your Copilot CLI folder and nothing else. Disconnect deletes it. Restart open Copilot sessions.",
  "agent.detail.opencode": "Connect adds one plugin file to your OpenCode folder (OpenCode 2) and nothing else. Disconnect deletes it. Restart OpenCode.",
  "agent.detail.not-found": "Not found on this machine.",
  "agent.file": "File",
  "connection.busy": "Working…",
  "connection.failed": "That did not work. Try again.",
} as const;

export type StringKey = keyof typeof EN;

type Params = Readonly<Record<string, string | number>>;

export function t(key: StringKey, params?: Params): string {
  const raw: string = EN[key];
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** Tools whose name says more than the phase does. Anything else falls back to the phase word. */
function toolWord(tool: string | null): StringKey | null {
  if (!tool) return null;
  if (tool === "Write") return "tool.write";
  if (tool === "WebFetch") return "tool.fetch";
  if (tool === "Agent" || tool === "Task") return "tool.delegate";
  if (tool.startsWith("mcp__")) return "tool.mcp";
  return null;
}

const ERROR_WORD: Record<ProblemKind, StringKey> = {
  usage_limit: "phase.limit",
  login: "error.login",
  connection: "error.connection",
  overloaded: "error.overloaded",
  model: "error.model",
  api: "error.api",
};

export interface Described {
  /** The big state word. */
  readonly word: string;
  /** One short line about the state that is not a file or command; null when there is nothing to add. */
  readonly hint: string | null;
}

function errorHint(s: SessionView): string | null {
  const problem = s.problem;
  if (!problem) return null;
  switch (problem.kind) {
    case "login":
      return s.agent === "claude" ? t("error.login.hint.claude") : t("error.login.hint.agent", { agent: s.agentLabel });
    case "connection":
      return t("error.connection.hint");
    case "overloaded":
      return t("error.overloaded.hint");
    case "model":
      return t("error.model.hint");
    case "usage_limit":
      return limitHint(s);
    case "api":
      return problem.message;
  }
}

function limitHint(s: SessionView): string {
  const problem = s.problem;
  const kind = problem?.message ? problem.message : t("hint.limit.plain");
  return problem?.resets ? `${kind} · ${t("hint.limit.resets", { when: problem.resets })}` : kind;
}

/** Maps a session to the state word and hint shown on the island. */
export function describeSession(s: SessionView): Described {
  switch (s.phase) {
    case "reading":
      return { word: t(toolWord(s.tool) ?? "phase.reading"), hint: null };
    case "searching":
      return { word: t(toolWord(s.tool) ?? "phase.searching"), hint: null };
    case "editing":
      return { word: t(toolWord(s.tool) ?? "phase.editing"), hint: null };
    case "running":
      return { word: t(toolWord(s.tool) ?? "phase.running"), hint: null };
    case "waiting":
      return { word: t("phase.waiting"), hint: t("hint.waiting") };
    case "paused":
      return { word: t("phase.paused"), hint: t("hint.paused") };
    case "stopped":
      return { word: t("phase.stopped"), hint: t("hint.stopped") };
    case "limit":
      return { word: t("phase.limit"), hint: limitHint(s) };
    case "error":
      return { word: t(ERROR_WORD[s.problem?.kind ?? "api"]), hint: errorHint(s) };
    case "done":
      return { word: t("phase.done"), hint: null };
    case "idle":
      return { word: t("phase.idle"), hint: null };
    case "thinking":
      return { word: t("phase.thinking"), hint: null };
  }
}

/** Text for the second row: what the agent is touching, or what happened. Null leaves the row empty. */
export function detailLine(s: SessionView): string | null {
  const { hint } = describeSession(s);
  switch (s.phase) {
    case "done":
      return s.summary ?? s.title;
    case "waiting":
      return s.detail ?? hint;
    case "paused":
    case "stopped":
    case "limit":
    case "error":
      return hint;
    default:
      return s.detail ?? s.title;
  }
}

export function connectionLabel(state: ConnectionState): string {
  return t(`connection.state.${state}`);
}

export function connectionDetail(state: ConnectionState): string {
  return t(`connection.detail.${state}`);
}
