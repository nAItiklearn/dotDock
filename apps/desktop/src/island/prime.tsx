import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { useMotionValue } from "motion/react";
import { Content } from "./Content";
import { layoutFor } from "./geometry";
import { Pager } from "./Pager";
import { Plate, usePlateMotion } from "./Plate";
import { islandVars, tokenRadius } from "./Island";
import { plateRadius } from "./squash";
import { t } from "./strings";
import type { IslandSettings, SessionView } from "./protocol";
import { SceneCanvas } from "./scene/SceneCanvas";
import { SCENE_CELL } from "./scene/layout";

/** Faces the expanded island draws with: state word (dot font), counters and subtitle (mono), labels (UI). */
const PRIMED_FONTS = ["16px Doto", "12px \"Geist Mono\"", "12px Geist"];

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
  const plate = usePlateMotion(layout, plateRadius(false, layout.h, tokenRadius(), settings.scale));
  const sessions = [primingSession("prime-a"), primingSession("prime-b")];
  const [first] = sessions as [SessionView, SessionView];
  const pagerTop = settings.showScene ? layout.sceneTop + 4 * settings.scale : layout.rowTop;
  // The same classes, sizes and layers as the expanded island (Island.tsx), so the compositor builds and
  // rasters exactly what the first real expansion will show.
  return (
    <main className="island-root" style={islandVars(settings.scale, layout)}>
      <div className="island-slide" style={{ top: settings.topOffset }}>
        <div className="island island--island" style={{ width: layout.w, height: layout.h }}>
          <Plate motion={plate} visible />
          <div className="island__active">
            <Content session={first} settings={settings} rows={rows} layout={layout} subtitle={t("phase.thinking")} flash={null} direction={1} live={false} follow={follow} />
            {settings.showScene ? (
              <div className="scene" style={{ top: layout.sceneTop }}>
                <SceneCanvas phase={first.phase} sessionId={first.id} iconStyle={settings.iconStyle} cell={SCENE_CELL * settings.scale} live={false} />
              </div>
            ) : null}
            <div className="pager-slot" style={{ top: pagerTop }}>
              <Pager sessions={sessions} currentId={first.id} onPick={() => undefined} />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

/** Frames the warm copy stays on the page: one to build its layers, one to raster and present them. */
const WARM_FRAMES = 2;

/**
 * Puts a copy of the expanded island on the page, all but invisible and taking no input, for two frames, then
 * removes it. The page's own fonts are loaded first.
 */
export async function primeOnce(settings: IslandSettings): Promise<void> {
  await Promise.all(PRIMED_FONTS.map((font) => document.fonts.load(font)));
  const host = document.createElement("div");
  host.className = "island-prime";
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(<PrimingTree settings={settings} />));
  for (let i = 0; i < WARM_FRAMES; i++) await new Promise((done) => requestAnimationFrame(done));
  root.unmount();
  host.remove();
}

/**
 * Warms the expanded island while it is idle after start. Traces of the soak test showed the very first
 * expansion costing a 34 ms task of first-run script and, once that was primed off the page, two single missed
 * frames of first-time layer building and raster (the plate's shadow and dot texture, the canvases, the
 * fonts at their expanded size). One idle callback does all of it once; no timer, nothing kept alive.
 */
export function primeActiveIsland(settings: IslandSettings): void {
  const run = (): void => {
    primeOnce(settings).catch((err: unknown) => console.error("island warm-up failed", err));
  };
  if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: PRIME_DEADLINE_MS });
  else setTimeout(run, 0);
}
