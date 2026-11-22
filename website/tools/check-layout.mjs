// Runs the layout check (tools/layout-check.js) in a headless Chrome against the preview server and fails when
// it finds anything: text over art, overlap, clipping, sideways scroll, at 390/414/768/1024/1280/1440 on every page.
// Usage: pnpm preview (in another shell), then node tools/check-layout.mjs [origin] [paths]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launch, profileDir } from "./cdp.mjs";

const ROOT = join(import.meta.dirname, "..");
const origin = process.argv[2] ?? "http://127.0.0.1:4330";
const paths = process.argv[3] ?? "/,/features,/download,/privacy,/license,/faq";
const check = readFileSync(join(import.meta.dirname, "layout-check.js"), "utf8");

const c = await launch({ profile: profileDir(ROOT) });
try {
  await c.viewport(1440, 900, 1);
  await c.goto(`${origin}/robots.txt?paths=${paths}`, 300);
  const result = await c.eval(`(${check})()`);
  for (const p of result.problems) console.log(`  ${p}`);
  console.log(`${result.count} finding(s) on ${result.pages.length} page(s) at ${result.widths.join(", ")} px`);
  process.exitCode = result.count === 0 ? 0 : 1;
} finally {
  c.close();
}
