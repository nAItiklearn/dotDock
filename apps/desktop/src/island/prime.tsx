import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { useMotionValue } from "motion/react";
import { Content } from "./Content";
import { layoutFor } from "./geometry";
import { Pager } from "./Pager";
import type { IslandSettings, SessionView } from "./protocol";
import { SceneCanvas } from "./scene/SceneCanvas";
import { SCENE_CELL } from "./scene/layout";

/** Longest the browser may postpone the priming render while it stays busy, ms. */
const PRIME_DEADLINE_MS = 3000;

/**
 * A session shaped like the first one the island will show. It only ever exists in a detached tree that is
 * never attached to the page, so nobody sees it.
 */
function primingSession(id: string): SessionView {
  return {
    id,
    agent: "claude",
    agentLabel: "",
    phase: "thinking",
    tool: null,
    detail: null,
    project: "",
    title: null,
    summary: null,
    problem: null,
    tokensOut: 0,
    contextTokens: null,
    turnStartedAt: null,
    updatedAt: 0,
    collapseAt: null,
  };
}

function PrimingTree({ settings }: { readonly settings: IslandSettings }) {
  const follow = useMotionValue(0);
  const rows = { subtitle: true, scene: settings.showScene };
  const layout = layoutFor(rows, settings.scale);
  const sessions = [primingSession("prime-a"), primingSession("prime-b")];
  const [first] = sessions as [SessionView, SessionView];
  return (
    <>
      <Content session={first} settings={settings} rows={rows} layout={layout} subtitle="" flash={null} direction={1} live={false} follow={follow} />
      <SceneCanvas phase={first.phase} sessionId={first.id} iconStyle={settings.iconStyle} cell={SCENE_CELL * settings.scale} live={false} />
      <Pager sessions={sessions} currentId={first.id} onPick={() => undefined} />
    </>
  );
}

/** Mounts and unmounts the priming tree once; returns the work so tests can run it without an idle callback. */
export function primeOnce(settings: IslandSettings): void {
  const host = document.createElement("div");
  const root = createRoot(host);
  flushSync(() => root.render(<PrimingTree settings={settings} />));
  root.unmount();
}

/**
 * Runs the expanded island's code once while the island is idle after start: the trace of the soak test showed
 * the very first expansion costing a 34 ms task (two dropped frames), most of it first-run work of the
 * components, the scene and the state icon. Doing that once, invisibly, at idle leaves the first real
 * expansion as cheap as every later one. One callback, no timer, nothing kept alive.
 */
export function primeActiveIsland(settings: IslandSettings): void {
  const run = (): void => primeOnce(settings);
  if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: PRIME_DEADLINE_MS });
  else setTimeout(run, 0);
}
