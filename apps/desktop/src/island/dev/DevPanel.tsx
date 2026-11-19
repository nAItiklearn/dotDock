import { useEffect, useRef, useState } from "react";
import { applyTheme, BUILTIN_THEMES, themeById } from "../../design-system/themes";
import { actions } from "../bridge";
import { IslandSettingsPanel } from "../settings/IslandSettingsPanel";
import { useIslandStore } from "../store";
import type { FocusOutcome, Phase, ProblemKind, Regions } from "../protocol";
import { dev } from "./devBackend";
import { ALL_PHASES, buildSnapshot, DEFAULT_SCENARIO, ERROR_KINDS, type Scenario } from "./fixtures";
import "./DevPanel.css";

const RAMP_MS = 450;
const RAMP_STEP = 40;
const FOCUS_OUTCOMES: readonly FocusOutcome[] = ["focused", "window-not-found", "session-ended"];
const MIX: readonly Exclude<Phase, "idle">[] = ["running", "thinking", "reading", "waiting"];

function Check({ label, checked, onChange }: { readonly label: string; readonly checked: boolean; readonly onChange: (v: boolean) => void }) {
  return (
    <label className="dev__check">
      <input type="checkbox" name={label} checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
      {label}
    </label>
  );
}

function RegionsOverlay({ regions }: { readonly regions: Regions }) {
  return (
    <div className="dev__regions" aria-hidden="true">
      {regions.hover ? <i className="dev__region dev__region--hover" style={{ left: regions.hover.x, top: regions.hover.y, width: regions.hover.w, height: regions.hover.h }} /> : null}
      {regions.interactive.map((r) => (
        <i key={`${r.x}:${r.y}`} className="dev__region dev__region--hit" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />
      ))}
    </div>
  );
}

export function DevPanel() {
  const [scenario, setScenario] = useState<Scenario>(DEFAULT_SCENARIO);
  const [ramping, setRamping] = useState(false);
  const [open, setOpen] = useState(true);
  const [regions, setRegions] = useState<Regions>({ interactive: [], hover: null });
  const [showRegions, setShowRegions] = useState(false);
  const pointerInside = useIslandStore((s) => s.pointerInside);
  const seq = useRef(0);

  useEffect(() => dev.onRegions(setRegions), []);
  useEffect(() => {
    const current = useIslandStore.getState().snapshot.current;
    dev.pushSnapshot(buildSnapshot(scenario, ++seq.current, current));
  }, [scenario]);
  useEffect(() => {
    if (!ramping) return undefined;
    const timer = setInterval(() => setScenario((s) => ({ ...s, tokens: s.tokens + Math.round(Math.random() * RAMP_STEP * 3) + RAMP_STEP })), RAMP_MS);
    return () => clearInterval(timer);
  }, [ramping]);

  const start = (phases: readonly Exclude<Phase, "idle">[]): void => setScenario((s) => ({ ...s, phases, epoch: Date.now() }));
  const patch = (next: Partial<Scenario>): void => setScenario((s) => ({ ...s, ...next }));
  const hasSessions = scenario.phases.length > 0;

  return (
    <>
      {showRegions ? <RegionsOverlay regions={regions} /> : null}
      <aside className="dev" data-open={open}>
        <header className="dev__head">
          <strong className="dev__badge">DEV ONLY — fixtures, not shipped</strong>
          <button type="button" onClick={() => setOpen(!open)}>
            {open ? "Hide" : "Show"}
          </button>
        </header>
        {open ? (
          <div className="dev__body">
            <fieldset>
              <legend>One session</legend>
              <div className="dev__wrap">
                <button type="button" onClick={() => start([])} data-on={!hasSessions}>
                  idle
                </button>
                {ALL_PHASES.map((p) => (
                  <button key={p} type="button" onClick={() => start([p])} data-on={scenario.phases.length === 1 && scenario.phases[0] === p}>
                    {p}
                  </button>
                ))}
              </div>
              <label className="dev__field">
                error kind
                <select name="error-kind" value={scenario.errorKind} onChange={(e) => patch({ errorKind: e.currentTarget.value as ProblemKind })}>
                  {ERROR_KINDS.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </label>
            </fieldset>

            <fieldset>
              <legend>Several sessions</legend>
              <div className="dev__wrap">
                {[2, 3, 4].map((n) => (
                  <button key={n} type="button" onClick={() => start(Array.from({ length: n }, (_, i) => MIX[i % MIX.length] as Exclude<Phase, "idle">))}>
                    {n} sessions
                  </button>
                ))}
                <button type="button" onClick={() => start(["done", "thinking", "error"])}>
                  done + working + error
                </button>
              </div>
              <Check label="second session is Codex" checked={scenario.codexSecond} onChange={(codexSecond) => patch({ codexSecond })} />
            </fieldset>

            <fieldset>
              <legend>Text</legend>
              <Check label="long file or command" checked={scenario.longDetail} onChange={(longDetail) => patch({ longDetail })} />
              <Check label="long project name" checked={scenario.longProject} onChange={(longProject) => patch({ longProject })} />
              <div className="dev__wrap">
                <button type="button" onClick={() => setRamping(!ramping)} data-on={ramping}>
                  tokens ramp
                </button>
                <button type="button" onClick={() => patch({ tokens: 842 })}>
                  842
                </button>
                <button type="button" onClick={() => patch({ tokens: 12_480 })}>
                  12.5k
                </button>
                <button type="button" onClick={() => patch({ tokens: 1_340_000 })}>
                  1.3M
                </button>
              </div>
            </fieldset>

            <fieldset>
              <legend>Environment</legend>
              <label className="dev__field">
                theme
                <select name="theme" defaultValue="obsidian" onChange={(e) => applyTheme(themeById(e.currentTarget.value))}>
                  {BUILTIN_THEMES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="dev__field">
                click outcome
                <select name="click-outcome" defaultValue="focused" onChange={(e) => dev.setFocusOutcome(e.currentTarget.value as FocusOutcome)}>
                  {FOCUS_OUTCOMES.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </label>
              <Check label="cursor over the island (hover simulation)" checked={pointerInside} onChange={(v) => useIslandStore.getState().setPointerInside(v)} />
              <Check label="draw hit regions (green = clicks, dashed = hover)" checked={showRegions} onChange={setShowRegions} />
              <button type="button" onClick={() => void actions.focus("fixture-0")}>
                call focus("fixture-0")
              </button>
            </fieldset>

            <fieldset>
              <legend>Settings panel (the real component)</legend>
              <div className="dev__settings">
                <IslandSettingsPanel />
              </div>
            </fieldset>
          </div>
        ) : null}
      </aside>
    </>
  );
}
