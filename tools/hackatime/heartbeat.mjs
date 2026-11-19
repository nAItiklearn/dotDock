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
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const PROJECT = "dotDock";
const PLUGIN = "claude-code/1 dotdock-heartbeat/1";
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const FILE_TOOLS = new Set([...WRITE_TOOLS, "Read"]);

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

  // NOT detached: on Windows a detached child gets its own console window and Node ignores
  // windowsHide for it, which flashed a terminal on every tool call. A non-detached child
  // shares our hidden console and still outlives us after unref().
  const child = spawn(cli, args, { stdio: "ignore", windowsHide: true });
  child.on("error", () => undefined);
  child.unref();
}

main().catch(() => undefined).finally(() => process.exit(0));
