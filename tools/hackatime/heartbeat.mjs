#!/usr/bin/env node
/**
 * Claude Code hook: sends one WakaTime/Hackatime heartbeat for the file a tool
 * actually touched. Real activity only: no back-filling, no replay, no timers.
 * Heartbeats are tagged category "ai coding" so the dashboard shows honestly
 * that the time came from an AI-assisted session.
 *
 * Reads the hook JSON from stdin. Always exits 0 so it can never block Claude.
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const PROJECT = "dotDock";
const PLUGIN = "claude-code/1 dotdock-heartbeat/1";
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const FILE_TOOLS = new Set([...WRITE_TOOLS, "Read"]);
/**
 * The CLI normally finishes in about a second, but with several agents sending at once it waits on its own
 * config and queue file locks; 20 s killed about 74 % of runs on 2026-11-21. Past this it is stuck and is
 * stopped. Must stay below the hook's own `timeout` in .claude/settings.json (60 s).
 */
const CLI_TIMEOUT_MS = 50_000;

function cliPath() {
  const dir = join(homedir(), ".wakatime");
  const candidates = ["wakatime-cli-windows-amd64.exe", "wakatime-cli.exe", "wakatime-cli"];
  for (const name of candidates) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function entityFor(event) {
  const input = event.tool_input ?? {};
  const raw = input.file_path ?? input.notebook_path;
  if (FILE_TOOLS.has(event.tool_name) && typeof raw === "string" && raw.length > 0) {
    return isAbsolute(raw) ? raw : resolve(event.cwd ?? process.cwd(), raw);
  }
  return null;
}

async function main() {
  const cli = cliPath();
  if (!cli) return;
  let event;
  try {
    event = JSON.parse(await readStdin());
  } catch {
    return;
  }
  const entity = entityFor(event);
  if (!entity) return;

  const args = [
    "--entity", entity,
    "--project", PROJECT,
    "--plugin", PLUGIN,
    "--category", "ai coding",
  ];
  if (WRITE_TOOLS.has(event.tool_name)) args.push("--write");

  // Wait for the CLI instead of firing and forgetting: the hook's process tree is torn down when
  // the hook exits, which killed an unref'd child before it could send. The hook is registered as
  // async, so Claude Code never waits for it. Not detached, so no console window flashes.
  const started = Date.now();
  const code = await new Promise((done) => {
    const child = spawn(cli, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), CLI_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      done(`spawn failed: ${err.message}`);
    });
    child.on("close", (exit) => {
      clearTimeout(timer);
      done(stderr.trim() ? `${exit} ${stderr.trim().slice(0, 200)}` : String(exit));
    });
  });
  trace(`${event.tool_name} exit=${code} ms=${Date.now() - started}`);
}

/** One line per heartbeat attempt in the app data folder, so a silent failure can be seen. Never the key. */
function trace(line) {
  try {
    const dir = join(process.env.LOCALAPPDATA ?? homedir(), "dockDock");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "hackatime-hook.log"), `${new Date().toISOString()} ${line}\n`);
  } catch {
    // Tracing must never break the hook.
  }
}

main().catch(() => undefined).finally(() => process.exit(0));
