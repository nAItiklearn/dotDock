// Serves the built site (.vercel/output/static) and the visit counter route, the way Vercel will. Astro's own
// `preview` does not support the Vercel adapter. The counter uses the same code as the deployed route
// (src/lib/visits.ts) and reads the same environment variables; without them /api/visits answers 200 with `available: false`.
// Usage: node tools/preview.mjs [port]   (default 4330)
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { Redis } from "@upstash/redis";
import { respond } from "../src/lib/visits.ts";

const root = join(import.meta.dirname, "..", ".vercel", "output", "static");
const port = Number(process.argv[2] ?? 4330);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".txt": "text/plain",
};

function resolveFile(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, "");
  const target = join(root, clean);
  if (target !== root && !target.startsWith(root + sep)) return null;
  if (existsSync(target) && statSync(target).isFile()) return target;
  const index = join(target, "index.html");
  return existsSync(index) ? index : null;
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  if (pathname === "/api/visits") {
    const reply = await respond(req.method ?? "GET", process.env, (c) => new Redis(c));
    res.writeHead(reply.status, Object.fromEntries(reply.headers));
    res.end(await reply.text());
    return;
  }
  const file = resolveFile(pathname);
  if (!file) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`dotDock preview on http://127.0.0.1:${port}`));
