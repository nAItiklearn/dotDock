// Measures where each recording's footage starts and ends (after the opening logo sting, before the closing card) and
// writes src/data/video-loops.json, so the site loops only the footage and never sits on black. Run after replacing a
// file in public/video: `node tools/video-loops.mjs` (needs ffmpeg on PATH; the build itself does not).
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

const NAMES = ["tour", "dock", "notch"];
const MIN_BLACK_S = 0.3;
const BLACK_PIXEL = 0.06;
const loops = {};
for (const name of NAMES) {
  const file = `public/video/${name}.mp4`;
  if (!existsSync(file)) continue;
  const log = spawnSync("ffmpeg", ["-v", "info", "-i", file, "-vf", `blackdetect=d=${MIN_BLACK_S}:pix_th=${BLACK_PIXEL}`, "-an", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const spans = [...log.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => ({ start: Number(m[1]), end: Number(m[2]) }));
  const first = spans[0];
  const last = spans.at(-1);
  if (!first || !last || first.start > 0 || spans.length < 2) continue;
  loops[name] = { start: first.end, end: last.start };
}
writeFileSync("src/data/video-loops.json", `${JSON.stringify(loops, null, 1)}\n`);
console.log(loops);
