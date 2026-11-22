import { useEffect, useState } from "react";
import { actions, connectIsland } from "../bridge";
import { DEFAULT_SETTINGS, type AgentConnection, type AgentState, type ConnectionStatus, type IconStyle, type IdleMode } from "../protocol";
import { useIslandStore } from "../store";
import { connectionDetail, connectionLabel, t } from "../strings";
import { Group, Row, Segmented, Slider, Switch } from "./controls";
import "./IslandSettingsPanel.css";

const SCALE_RANGE = { min: 0.8, max: 1.4, step: 0.05 } as const;
const OFFSET_RANGE = { min: 0, max: 64, step: 1 } as const;
const VOLUME_RANGE = { min: 0, max: 1, step: 0.05 } as const;
const LINGER_RANGE = { min: 2, max: 30, step: 1 } as const;

const IDLE_OPTIONS: readonly { readonly value: IdleMode; readonly label: string }[] = [
  { value: "tiny", label: t("settings.idle.tiny") },
  { value: "hidden", label: t("settings.idle.hidden") },
];
const STYLE_OPTIONS: readonly { readonly value: IconStyle; readonly label: string }[] = [
  { value: "dots", label: t("settings.iconStyle.dots") },
  { value: "blocks", label: t("settings.iconStyle.blocks") },
  { value: "stripes", label: t("settings.iconStyle.stripes") },
];

const percent = (value: number): string => t("settings.unit.percent", { value: Math.round(value * 100) });

function ConnectionSection({ connection }: { readonly connection: ConnectionStatus }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const run = (action: () => Promise<void>): void => {
    setBusy(true);
    setFailed(false);
    action()
      .catch((err: unknown) => {
        console.error("island connection change failed", err);
        setFailed(true);
      })
      .finally(() => setBusy(false));
  };

  const { state } = connection;
  const connected = state === "connected";
  const canChange = state === "connected" || state === "disconnected" || state === "outdated";
  const tone = connected ? "ok" : state === "outdated" ? "warn" : "off";

  return (
    <Group title={t("settings.section.connections")}>
      <div className="isl-conn">
        <div className="isl-conn__head">
          <span className="isl-conn__dot" data-tone={tone} aria-hidden="true" />
          <span className="isl-conn__state">{connectionLabel(state)}</span>
          <button
            type="button"
            className={`isl-button${connected ? "" : " isl-button--primary"}`}
            disabled={!canChange || busy}
            onClick={() => run(connected ? actions.disconnect : actions.connect)}
          >
            {busy ? t("connection.busy") : connected ? t("connection.disconnect") : state === "outdated" ? t("connection.reconnect") : t("connection.connect")}
          </button>
        </div>
        <p className="isl-conn__detail">{failed ? t("connection.failed") : connectionDetail(state)}</p>
        <dl className="isl-conn__facts">
          <dt>{t("connection.file")}</dt>
          <dd className="isl-conn__path" title={connection.settingsPath}>
            {connection.settingsPath}
          </dd>
          <dt>Codex</dt>
          <dd>{connection.codexAvailable ? t("connection.codex.found") : t("connection.codex.missing")}</dd>
          <dt>{t("connection.feed")}</dt>
          <dd className="isl-conn__path" title={connection.feedDir}>
            {connection.feedDir}
          </dd>
        </dl>
        <p className="isl-conn__detail">{t("connection.feed.hint")}</p>
      </div>
      {connection.agents.map((agent) => (
        <AgentRow key={agent.agent} connection={agent} />
      ))}
    </Group>
  );
}

const AGENT_TONE: Record<AgentState, "ok" | "warn" | "off"> = {
  connected: "ok",
  outdated: "warn",
  "hook-missing": "warn",
  disconnected: "off",
  "not-found": "off",
};

/** One agent that Connect sets up with a single file of its own: state, the file, and the button. */
function AgentRow({ connection }: { readonly connection: AgentConnection }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const { agent, state, file } = connection;
  const connected = state === "connected";
  const canChange = state !== "not-found" && state !== "hook-missing";

  const run = (): void => {
    setBusy(true);
    setFailed(false);
    (connected ? actions.disconnectAgent(agent) : actions.connectAgent(agent))
      .catch((err: unknown) => {
        console.error(`island ${agent} connection change failed`, err);
        setFailed(true);
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="isl-conn">
      <div className="isl-conn__head">
        <span className="isl-conn__dot" data-tone={AGENT_TONE[state]} aria-hidden="true" />
        <span className="isl-conn__state">
          {t(`agent.${agent}`)} · {t(`agent.state.${state}`)}
        </span>
        <button type="button" className={`isl-button${connected ? "" : " isl-button--primary"}`} disabled={!canChange || busy} onClick={run}>
          {busy ? t("connection.busy") : connected ? t("connection.disconnect") : state === "outdated" ? t("connection.reconnect") : t("connection.connect")}
        </button>
      </div>
      <p className="isl-conn__detail">{failed ? t("connection.failed") : state === "not-found" ? t("agent.detail.not-found") : t(`agent.detail.${agent}`)}</p>
      {file ? (
        <dl className="isl-conn__facts">
          <dt>{t("agent.file")}</dt>
          <dd className="isl-conn__path" title={file}>
            {file}
          </dd>
        </dl>
      ) : null}
    </div>
  );
}

/**
 * Every Agent Island setting in one panel, for the Settings window to embed.
 * Changes apply instantly; the core stores them and the island window follows.
 */
export function IslandSettingsPanel() {
  const settings = useIslandStore((s) => s.settings);
  const connection = useIslandStore((s) => s.connection);
  useEffect(() => {
    connectIsland().catch((err: unknown) => console.error("island settings could not connect", err));
  }, []);

  const set = actions.updateSettings;
  return (
    <div className="isl-settings">
      <header className="isl-settings__head">
        <h2 className="isl-settings__title">{t("settings.title")}</h2>
        <button type="button" className="isl-button" onClick={() => set(DEFAULT_SETTINGS)}>
          {t("settings.reset")}
        </button>
      </header>

      {connection ? <ConnectionSection connection={connection} /> : null}

      <Group title={t("settings.section.display")}>
        <Row label={t("settings.idle")} group>{({ labelId }) => <Segmented labelId={labelId} value={settings.idle} options={IDLE_OPTIONS} onChange={(idle) => set({ idle })} />}</Row>
        <Row label={t("settings.iconStyle")} group>
          {({ labelId }) => <Segmented labelId={labelId} value={settings.iconStyle} options={STYLE_OPTIONS} onChange={(iconStyle) => set({ iconStyle })} />}
        </Row>
        <Row label={t("settings.scale")}>
          {({ id }) => <Slider id={id} value={settings.scale} {...SCALE_RANGE} display={percent(settings.scale)} onChange={(scale) => set({ scale })} />}
        </Row>
        <Row label={t("settings.topOffset")}>
          {({ id }) => (
            <Slider
              id={id}
              value={settings.topOffset}
              {...OFFSET_RANGE}
              display={t("settings.unit.px", { value: settings.topOffset })}
              onChange={(topOffset) => set({ topOffset })}
            />
          )}
        </Row>
      </Group>

      <Group title={t("settings.section.content")}>
        <Row label={t("settings.showDetail")}>{({ id }) => <Switch id={id} checked={settings.showDetail} onChange={(showDetail) => set({ showDetail })} />}</Row>
        <Row label={t("settings.showTokens")}>{({ id }) => <Switch id={id} checked={settings.showTokens} onChange={(showTokens) => set({ showTokens })} />}</Row>
        <Row label={t("settings.showElapsed")}>{({ id }) => <Switch id={id} checked={settings.showElapsed} onChange={(showElapsed) => set({ showElapsed })} />}</Row>
        <Row label={t("settings.showProject")}>{({ id }) => <Switch id={id} checked={settings.showProject} onChange={(showProject) => set({ showProject })} />}</Row>
        <Row label={t("settings.showScene")}>{({ id }) => <Switch id={id} checked={settings.showScene} onChange={(showScene) => set({ showScene })} />}</Row>
      </Group>

      <Group title={t("settings.section.behaviour")}>
        <Row label={t("settings.moveAside")}>{({ id }) => <Switch id={id} checked={settings.moveAside} onChange={(moveAside) => set({ moveAside })} />}</Row>
        <Row label={t("settings.followCursor")}>{({ id }) => <Switch id={id} checked={settings.followCursor} onChange={(followCursor) => set({ followCursor })} />}</Row>
        <Row label={t("settings.codex")}>{({ id }) => <Switch id={id} checked={settings.codex} onChange={(codex) => set({ codex })} />}</Row>
        <Row label={t("settings.doneLinger")}>
          {({ id }) => (
            <Slider
              id={id}
              value={settings.doneLingerSecs}
              {...LINGER_RANGE}
              display={t("settings.unit.seconds", { value: settings.doneLingerSecs })}
              onChange={(doneLingerSecs) => set({ doneLingerSecs })}
            />
          )}
        </Row>
      </Group>

      <Group title={t("settings.section.sound")}>
        <Row label={t("settings.notify")}>{({ id }) => <Switch id={id} checked={settings.notify} onChange={(notify) => set({ notify })} />}</Row>
        <Row label={t("settings.sound")}>{({ id }) => <Switch id={id} checked={settings.sound} onChange={(sound) => set({ sound })} />}</Row>
        <Row label={t("settings.volume")} disabled={!settings.sound}>
          {({ id }) => (
            <Slider
              id={id}
              value={settings.volume}
              {...VOLUME_RANGE}
              disabled={!settings.sound}
              display={percent(settings.volume)}
              onChange={(volume) => set({ volume })}
            />
          )}
        </Row>
      </Group>
    </div>
  );
}
