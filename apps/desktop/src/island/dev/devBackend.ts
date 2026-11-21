import type { Handlers, IslandBackend } from "../bridge";
import {
  DEFAULT_SETTINGS,
  type AgentConnection,
  type AgentState,
  type ConnectableAgent,
  type ConnectionState,
  type ConnectionStatus,
  type FocusOutcome,
  type InitialState,
  type Regions,
  type Snapshot,
} from "../protocol";
import { EMPTY_SNAPSHOT } from "../store";

/** DEV ONLY. Stands in for the Tauri core so the island can be designed in a plain browser. */

const SETTINGS_PATH = String.raw`C:\Users\Example\.claude\settings.json`;
const AGENT_FILES: Readonly<Record<ConnectableAgent, string>> = {
  copilot: String.raw`C:\Users\Example\.copilot\hooks\dotdock-island.json`,
  opencode: String.raw`C:\Users\Example\.config\opencode\plugins\dotdock-island.js`,
};
const FEED_DIR = String.raw`C:\Users\Example\AppData\Local\dev.dotdock.desktop\agents`;
const LATENCY_MS = 450;

let handlers: Handlers | null = null;
let connection: ConnectionState = "disconnected";
const agentStates: Record<ConnectableAgent, AgentState> = { copilot: "disconnected", opencode: "disconnected" };
let focusOutcome: FocusOutcome = "focused";
let regionListener: (regions: Regions) => void = () => undefined;

const agents = (): readonly AgentConnection[] =>
  (Object.keys(AGENT_FILES) as ConnectableAgent[]).map((agent) => ({ agent, state: agentStates[agent], file: AGENT_FILES[agent] }));
const status = (state: ConnectionState): ConnectionStatus => ({
  state,
  settingsPath: SETTINGS_PATH,
  codexAvailable: true,
  agents: agents(),
  feedDir: FEED_DIR,
});
const wait = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, LATENCY_MS));

export const dev = {
  /** Sends a snapshot through the same path a Tauri event takes. */
  pushSnapshot: (snapshot: Snapshot): void => handlers?.snapshot(snapshot),
  setFocusOutcome: (outcome: FocusOutcome): void => {
    focusOutcome = outcome;
  },
  onRegions: (listener: (regions: Regions) => void): void => {
    regionListener = listener;
  },
};

export const devBackend: IslandBackend = {
  loadInitial: (): Promise<InitialState> =>
    Promise.resolve({ snapshot: EMPTY_SNAPSHOT, settings: DEFAULT_SETTINGS, connection: status(connection) }),
  subscribe: (next) => {
    handlers = next;
    return Promise.resolve(() => {
      handlers = null;
    });
  },
  setRegions: (regions) => regionListener(regions),
  focus: () => Promise.resolve(focusOutcome),
  dismiss: () => undefined,
  connect: async () => {
    await wait();
    connection = "connected";
    return status(connection);
  },
  disconnect: async () => {
    await wait();
    connection = "disconnected";
    return status(connection);
  },
  connectAgent: async (agent) => {
    await wait();
    agentStates[agent] = "connected";
    return status(connection);
  },
  disconnectAgent: async (agent) => {
    await wait();
    agentStates[agent] = "disconnected";
    return status(connection);
  },
  saveSettings: () => undefined,
  ready: () => undefined,
};
