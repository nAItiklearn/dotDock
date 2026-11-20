// Agent Island for OpenCode.
//
// dotDock writes this file when you press Connect in the island settings and deletes it on Disconnect.
// It reports what OpenCode is doing (state, tool, file or command, token counts) to a folder on this
// computer that the island reads. It sends nothing over the network and copies no prompts, no tool output
// and no file contents: tool input is cut down to the few fields that name a file, pattern, command or
// address, and a reply to its first 300 characters.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SPOOL_DIR = __SPOOL_DIR__;
const TEXT_LIMIT = 300;
const EVENTS = [
  "session.created",
  "session.renamed",
  "session.deleted",
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.step.started",
  "session.step.ended",
  "session.reasoning.started",
  "session.tool.input.started",
  "session.tool.called",
  "session.tool.success",
  "session.tool.failed",
  "session.text.ended",
  "permission.asked",
  "permission.replied",
];
const INPUT_KEYS = ["filePath", "file_path", "path", "pattern", "query", "command", "cmd", "description", "url"];

// Values that look like credentials never reach the feed file: the island masks them again when it shows them.
const SECRET_FLAG = /((?:--?(?:token|password|passwd|secret|api[-_]?key|auth)|bearer)(?:=|\s+))\S+/gi;
const SECRET_ASSIGNMENT = /(\b\w*(?:token|secret|password|passwd|api_?key|auth)\w*=)\S+/gi;
const SECRET_VALUE = /\b(?:sk-|ghp_|gho_|github_pat_|xox[bp]-|akia|eyj)[\w-]{12,}/gi;
const mask = (text) => text.replace(SECRET_FLAG, "$1…").replace(SECRET_ASSIGNMENT, "$1…").replace(SECRET_VALUE, "…");

const clip = (value) => (typeof value === "string" ? mask(value).slice(0, TEXT_LIMIT) : undefined);

/** The lines of a patch that name a file (`*** Update File: ...`), without the changed code. */
const patchHeaders = (patch) =>
  typeof patch === "string"
    ? patch
        .split("\n")
        .filter((line) => line.startsWith("*** "))
        .slice(0, 3)
        .join("\n")
    : undefined;

function pickInput(input) {
  const picked = {};
  for (const key of INPUT_KEYS) {
    const text = clip(input?.[key]);
    if (text !== undefined) picked[key] = text;
  }
  const patch = patchHeaders(input?.patchText);
  if (patch) picked.patchText = patch;
  return picked;
}

function project(type, data) {
  const base = { sessionID: data.sessionID };
  switch (type) {
    case "session.created":
      return { ...base, parentID: data.parentID, title: clip(data.title), location: data.location };
    case "session.renamed":
      return { ...base, title: clip(data.title) };
    case "session.tool.input.started":
      return { ...base, id: data.id, name: data.name };
    case "session.tool.called":
      return { ...base, id: data.id, input: pickInput(data.input) };
    case "session.tool.success":
    case "session.tool.failed":
      return { ...base, id: data.id };
    case "session.text.ended":
      return { ...base, text: clip(data.text) };
    case "session.step.ended":
      return { ...base, tokens: data.tokens };
    case "session.execution.failed":
      return {
        ...base,
        error: { type: data.error?.type, message: clip(data.error?.message), status: data.error?.status },
      };
    case "permission.asked":
      return { ...base, action: data.action, resources: (data.resources ?? []).slice(0, 2).map(clip) };
    default:
      return base;
  }
}

function report(file, event) {
  const line = {
    v: 1,
    adapter: "opencode",
    pid: process.pid,
    event: {
      id: event.id,
      type: event.type,
      created: event.created,
      location: event.location ? { directory: event.location.directory } : undefined,
      data: project(event.type, event.data ?? {}),
    },
  };
  appendFileSync(file, `${JSON.stringify(line)}\n`);
}

export default {
  id: "dotdock.island",
  setup(ctx) {
    const controller = new AbortController();
    const file = join(SPOOL_DIR, `opencode-${process.pid}.jsonl`);
    // The island is optional; OpenCode must never notice it is missing, so nothing below may throw.
    try {
      mkdirSync(SPOOL_DIR, { recursive: true });
    } catch {
      // Reporting fails quietly per event instead.
    }
    void (async () => {
      for await (const event of ctx.event.subscribe({ types: EVENTS, signal: controller.signal })) {
        try {
          report(file, event);
        } catch {
          // See above.
        }
      }
    })().catch(() => undefined);
    return () => controller.abort();
  },
};
