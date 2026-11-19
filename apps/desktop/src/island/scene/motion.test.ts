import { describe, expect, it } from "vitest";
import type { Phase } from "../protocol";
import { WALK_MAX, WALK_MIN } from "./layout";
import { INITIAL_SCENE, stepScene, type SceneState } from "./motion";

const DT = 1 / 30;

function run(state: SceneState, phase: Phase, seconds: number): SceneState {
  let s = state;
  for (let i = 0; i < Math.round(seconds / DT); i++) s = stepScene(s, phase, DT);
  return s;
}

describe("scene motion", () => {
  it("never moves the beetle faster than its top speed, whatever the phase sequence", () => {
    const phases: Phase[] = ["thinking", "reading", "running", "searching", "reading", "done", "running", "error", "reading"];
    let s = INITIAL_SCENE;
    for (let i = 0; i < 900; i++) {
      const phase = phases[Math.floor(i / 20) % phases.length] as Phase;
      const next = stepScene(s, phase, DT);
      expect(Math.abs(next.x - s.x)).toBeLessThanOrEqual(30 * DT + 1e-9);
      expect(next.x).toBeGreaterThanOrEqual(WALK_MIN);
      expect(next.x).toBeLessThanOrEqual(WALK_MAX);
      s = next;
    }
  });

  it("eases into a stroll instead of starting at full speed", () => {
    const first = stepScene(INITIAL_SCENE, "reading", DT);
    expect(first.speed).toBeGreaterThan(0);
    expect(first.speed).toBeLessThan(2);
    expect(run(INITIAL_SCENE, "reading", 1).speed).toBeCloseTo(9, 5);
  });

  it("stops, turns around at the edge of the strip and walks back", () => {
    let s: SceneState = { ...INITIAL_SCENE, x: WALK_MAX - 6 };
    let turned = false;
    let slowestAtTurn = Infinity;
    for (let i = 0; i < 300; i++) {
      const next = stepScene(s, "reading", DT);
      if (next.dir !== s.dir) {
        turned = true;
        slowestAtTurn = next.speed;
      }
      s = next;
    }
    expect(turned).toBe(true);
    expect(slowestAtTurn).toBeLessThan(0.5);
    expect(s.dir).toBe(-1);
    expect(s.x).toBeLessThan(WALK_MAX - 6);
  });

  it("holds still in every phase except reading and the run-up to a sprint", () => {
    for (const phase of ["thinking", "searching", "editing", "waiting", "done", "paused", "limit", "error", "stopped"] as const) {
      const s = run({ ...INITIAL_SCENE, speed: 9 }, phase, 2);
      expect(s.speed).toBe(0);
      expect(s.gait).toBeGreaterThan(INITIAL_SCENE.gait);
    }
    const resting = run(INITIAL_SCENE, "thinking", 2);
    expect(resting.gait).toBe(0);
  });

  it("sprints to its spot while the landscape rushes by, then stays there", () => {
    const sprinting = run(INITIAL_SCENE, "running", 3);
    expect(sprinting.scrollSpeed).toBeCloseTo(70, 5);
    expect(sprinting.scroll).toBeGreaterThan(150);
    expect(sprinting.dir).toBe(1);
    expect(sprinting.x).toBeGreaterThanOrEqual(39);
    expect(Math.abs(sprinting.x - run(sprinting, "running", 1).x)).toBeLessThan(0.01);
  });

  it("runs back to its spot from the far edge, facing that way, with the world scrolling against it", () => {
    const edge: SceneState = { ...INITIAL_SCENE, x: WALK_MAX, dir: 1 };
    const back = run(edge, "running", 6);
    expect(back.dir).toBe(-1);
    expect(back.x).toBeLessThan(WALK_MAX - 40);
    expect(back.x).toBeLessThanOrEqual(42);
    expect(back.scrollSpeed).toBeCloseTo(-70, 5);
  });

  it("lets the landscape coast to a stop when the sprint ends", () => {
    const sprinting = run(INITIAL_SCENE, "running", 2);
    const coasting = stepScene(sprinting, "thinking", DT);
    expect(coasting.scrollSpeed).toBeLessThan(sprinting.scrollSpeed);
    expect(coasting.scrollSpeed).toBeGreaterThan(0);
    expect(run(sprinting, "thinking", 2).scrollSpeed).toBe(0);
  });

  it("treats a long pause as one short step", () => {
    expect(stepScene(INITIAL_SCENE, "reading", 5)).toEqual(stepScene(INITIAL_SCENE, "reading", 0.1));
  });

  it("keeps the leg cycle within what 30 frames per second can show", () => {
    const sprinting = run(INITIAL_SCENE, "running", 2);
    const cycles = stepScene(sprinting, "running", DT).gait - sprinting.gait;
    expect(cycles / DT).toBeLessThanOrEqual(6 + 1e-9);
  });
});
