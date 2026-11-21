import { useEffect, useState, type ReactNode } from "react";
import { actions, connectIsland, hasIslandBackend } from "../../island/bridge";
import { DEFAULT_SETTINGS, type ConnectionStatus, type IconStyle, type IdleMode, type IslandSettings } from "../../island/protocol";
import { useIslandStore } from "../../island/store";
import { connectionDetail, connectionLabel, t } from "../../island/strings";
import { Button, Segmented, Slider, Switch } from "../../lib/ui/controls";
import { Icon } from "../../lib/ui/Icon";
import { PageHeader, Row, Section } from "../ui/layout";

/** The island's own limits (protocol.ts documents them; the core clamps to the same). */
const SCALE_RANGE = { min: 0.8, max: 1.4, step: 0.05 } as const;
const OFFSET_RANGE = { min: 0, max: 64, step: 1 } as const;
const VOLUME_RANGE = { min: 0, max: 1, step: 0.05 } as const;
const LINGER_RANGE = { min: 2, max: 30, step: 1 } as const;
const PERCENT = 100;

const IDLE_OPTIONS: readonly { readonly value: IdleMode; readonly label: string }[] = [
  { value: "tiny", label: t("settings.idle.tiny") },
  { value: "hidden", label: t("settings.idle.hidden") },
];
const STYLE_OPTIONS: readonly { readonly value: IconStyle; readonly label: string }[] = [
  { value: "dots", label: t("settings.iconStyle.dots") },
  { value: "blocks", label: t("settings.iconStyle.blocks") },
  { value: "stripes", label: t("settings.iconStyle.stripes") },
];

const percent = (value: number): string => t("settings.unit.percent", { value: Math.round(value * PERCENT) });

/** Reads the island's settings and connection from the core, and keeps them live while the page is open. */
function useIsland(): { readonly settings: IslandSettings; readonly connection: ConnectionStatus | null } {
  const settings = useIslandStore((s) => s.settings);
  const connection = useIslandStore((s) => s.connection);
  useEffect(() => {
    connectIsland().catch((err: unknown) => console.error("island settings could not connect", err));
  }, []);
  return { settings, connection };
}

type BooleanKey = { [K in keyof IslandSettings]: IslandSettings[K] extends boolean ? K : never }[keyof IslandSettings];

interface ToggleRowProps {
  readonly id: string;
  readonly setting: BooleanKey;
  readonly label: string;
  readonly description: string;
  readonly settings: IslandSettings;
  readonly disabled?: boolean;
}

function ToggleRow({ id, setting, label, description, settings, disabled = false }: ToggleRowProps) {
  const value = settings[setting];
  return (
    <Row id={id} label={label} description={description} isDefault={value === DEFAULT_SETTINGS[setting]} onReset={() => actions.updateSettings({ [setting]: DEFAULT_SETTINGS[setting] })}>
      <Switch checked={value} label={label} disabled={disabled} onChange={(next) => actions.updateSettings({ [setting]: next })} />
    </Row>
  );
}

function SliderValue({ children }: { readonly children: ReactNode }) {
  return <span className="control-value tabular">{children}</span>;
}

/** In a plain browser there is no core to talk to; say what the page does instead of showing dead controls. */
function NeedsApp({ offers }: { readonly offers: readonly string[] }) {
  return (
    <div className="gate">
      <span className="gate__icon">
        <Icon name="notch" size={22} />
      </span>
      <h2 className="gate__title">Available in the desktop app</h2>
      <p className="gate__text">The notch runs in the installed app. Here it would let you:</p>
      <ul className="gate__list">
        {offers.map((offer) => (
          <li key={offer}>{offer}</li>
        ))}
      </ul>
    </div>
  );
}

function ClaudeCodeRow({ connection }: { readonly connection: ConnectionStatus }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const { state } = connection;
  const connected = state === "connected";
  const canChange = state === "connected" || state === "disconnected" || state === "outdated";

  const run = (): void => {
    if (busy || !canChange) return;
    setBusy(true);
    setFailed(false);
    (connected ? actions.disconnect() : actions.connect())
      .catch((err: unknown) => {
        console.error("island connection change failed", err);
        setFailed(true);
      })
      .finally(() => setBusy(false));
  };

  const tone = connected ? "ok" : state === "outdated" ? "warn" : "off";
  return (
    <Row
      id="agent-claude"
      label="Claude Code"
      description={
        <>
          <span className="status-line">
            <span className="status-line__dot" data-tone={tone} aria-hidden="true" />
            {connectionLabel(state)}.
          </span>{" "}
          {failed ? t("connection.failed") : connectionDetail(state)}
          <span className="mono-path row__path" title={connection.settingsPath}>
            {connection.settingsPath}
          </span>
        </>
      }
    >
      <Button variant={connected ? "default" : "primary"} disabled={!canChange || busy} onClick={run}>
        {busy ? t("connection.busy") : connected ? t("connection.disconnect") : state === "outdated" ? t("connection.reconnect") : t("connection.connect")}
      </Button>
    </Row>
  );
}

export function AgentsPage() {
  const { settings, connection } = useIsland();
  const available = hasIslandBackend();
  return (
    <>
      <PageHeader page="agents" />
      {!available ? (
        <NeedsApp
          offers={[
            "Connect Claude Code in one click, and disconnect it just as easily.",
            "Follow Codex tasks from its local logs.",
            "Hear a chime when a task finishes, and keep it on the notch for as long as you like.",
          ]}
        />
      ) : (
        <>
          <Section title="Agents" description="The notch shows what each connected agent is doing. Connecting only adds the notch's hooks; your other settings stay as they are.">
            {connection ? <ClaudeCodeRow connection={connection} /> : null}
            <Row
              id="agent-codex"
              label="Codex"
              description={connection?.codexAvailable ? "Reads Codex's local session logs. Nothing is changed." : "Codex is not installed on this PC."}
              isDefault={settings.codex === DEFAULT_SETTINGS.codex}
              onReset={() => actions.updateSettings({ codex: DEFAULT_SETTINGS.codex })}
            >
              <Switch checked={settings.codex} label="Also show Codex tasks" disabled={connection?.codexAvailable === false} onChange={(codex) => actions.updateSettings({ codex })} />
            </Row>
          </Section>
          <Section title="When a task finishes">
            <Row
              id="done-linger"
              label="Keep it visible for"
              description="How long a finished task stays on the notch."
              isDefault={settings.doneLingerSecs === DEFAULT_SETTINGS.doneLingerSecs}
              onReset={() => actions.updateSettings({ doneLingerSecs: DEFAULT_SETTINGS.doneLingerSecs })}
            >
              <span className="control-with-value">
                <Slider
                  label="Keep a finished task visible"
                  value={settings.doneLingerSecs}
                  {...LINGER_RANGE}
                  valueText={`${settings.doneLingerSecs} seconds`}
                  onChange={(doneLingerSecs) => actions.updateSettings({ doneLingerSecs })}
                />
                <SliderValue>{t("settings.unit.seconds", { value: settings.doneLingerSecs })}</SliderValue>
              </span>
            </Row>
            <ToggleRow id="sound" setting="sound" label="Play a sound" description="A short chime, made by the app." settings={settings} />
            <Row
              id="volume"
              label="Volume"
              description={settings.sound ? "How loud the chime is." : "Turn on the sound to set its volume."}
              isDefault={settings.volume === DEFAULT_SETTINGS.volume}
              onReset={() => actions.updateSettings({ volume: DEFAULT_SETTINGS.volume })}
            >
              <span className="control-with-value">
                <Slider
                  label="Volume"
                  value={settings.volume}
                  {...VOLUME_RANGE}
                  disabled={!settings.sound}
                  valueText={percent(settings.volume)}
                  onChange={(volume) => actions.updateSettings({ volume })}
                />
                <SliderValue>{percent(settings.volume)}</SliderValue>
              </span>
            </Row>
          </Section>
        </>
      )}
    </>
  );
}

export function NotchLookPage() {
  const { settings } = useIsland();
  const available = hasIslandBackend();
  return (
    <>
      <PageHeader page="notch-look" />
      {!available ? (
        <NeedsApp offers={["Choose its size, dot style and distance from the top.", "Pick what it shows: the file, tokens, time, project and the creature."]} />
      ) : (
        <>
          <Section title="Notch">
            <Row
              id="notch-idle"
              label={t("settings.idle")}
              description="A small pill keeps its place; hidden leaves the top of the screen clear."
              isDefault={settings.idle === DEFAULT_SETTINGS.idle}
              onReset={() => actions.updateSettings({ idle: DEFAULT_SETTINGS.idle })}
            >
              <Segmented label={t("settings.idle")} value={settings.idle} options={IDLE_OPTIONS} onChange={(idle) => actions.updateSettings({ idle })} />
            </Row>
            <Row
              id="notch-style"
              label={t("settings.iconStyle")}
              description="How the 7 by 7 state icon is drawn."
              isDefault={settings.iconStyle === DEFAULT_SETTINGS.iconStyle}
              onReset={() => actions.updateSettings({ iconStyle: DEFAULT_SETTINGS.iconStyle })}
            >
              <Segmented label={t("settings.iconStyle")} value={settings.iconStyle} options={STYLE_OPTIONS} onChange={(iconStyle) => actions.updateSettings({ iconStyle })} />
            </Row>
            <Row
              id="notch-scale"
              label={t("settings.scale")}
              description="Scales the whole notch."
              isDefault={settings.scale === DEFAULT_SETTINGS.scale}
              onReset={() => actions.updateSettings({ scale: DEFAULT_SETTINGS.scale })}
            >
              <span className="control-with-value">
                <Slider label={t("settings.scale")} value={settings.scale} {...SCALE_RANGE} valueText={percent(settings.scale)} onChange={(scale) => actions.updateSettings({ scale })} />
                <SliderValue>{percent(settings.scale)}</SliderValue>
              </span>
            </Row>
            <Row
              id="notch-offset"
              label={t("settings.topOffset")}
              description="Room between the notch and the top of the screen."
              isDefault={settings.topOffset === DEFAULT_SETTINGS.topOffset}
              onReset={() => actions.updateSettings({ topOffset: DEFAULT_SETTINGS.topOffset })}
            >
              <span className="control-with-value">
                <Slider
                  label={t("settings.topOffset")}
                  value={settings.topOffset}
                  {...OFFSET_RANGE}
                 
                  valueText={`${settings.topOffset} pixels`}
                  onChange={(topOffset) => actions.updateSettings({ topOffset })}
                />
                <SliderValue>{t("settings.unit.px", { value: settings.topOffset })}</SliderValue>
              </span>
            </Row>
          </Section>
          <Section title="What it shows">
            <ToggleRow id="notch-detail" setting="showDetail" label={t("settings.showDetail")} description="The file being edited or the command being run." settings={settings} />
            <ToggleRow id="notch-tokens" setting="showTokens" label={t("settings.showTokens")} description="Only real counts the agent reports." settings={settings} />
            <ToggleRow id="notch-elapsed" setting="showElapsed" label={t("settings.showElapsed")} description="How long the current task has been running." settings={settings} />
            <ToggleRow id="notch-project" setting="showProject" label={t("settings.showProject")} description="The folder the agent is working in." settings={settings} />
            <ToggleRow id="notch-scene" setting="showScene" label={t("settings.showScene")} description="The beetle and its landscape along the bottom edge." settings={settings} />
          </Section>
          <Section title="Movement">
            <ToggleRow id="notch-aside" setting="moveAside" label={t("settings.moveAside")} description="Slides out of the way so you can click what is under it." settings={settings} />
            <ToggleRow id="notch-follow" setting="followCursor" label={t("settings.followCursor")} description="Moves when the cursor touches the top edge of another screen." settings={settings} />
          </Section>
        </>
      )}
    </>
  );
}
