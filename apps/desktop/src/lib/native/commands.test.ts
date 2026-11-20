import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every command the UI invokes must be registered with Tauri, or the call fails at run time and the
 * feature behind it silently does nothing. This reads the real sources on both sides.
 */
const SRC = resolve(__dirname, "../..");
const CORE = resolve(SRC, "../src-tauri/src/lib.rs");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** `invoke("x")`, `invoke<T>("x")` and the native API's `call("x")` / `call<T>("x")` helpers. */
const INVOKE = /\b(?:invoke|call)\s*(?:<[^>()]*>)?\(\s*["']([a-z][a-z0-9_]*)["']/g;

function invokedCommands(files: readonly string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of files) {
    for (const match of readFileSync(file, "utf8").matchAll(INVOKE)) {
      const name = match[1] as string;
      if (!found.has(name)) found.set(name, relative(SRC, file));
    }
  }
  return found;
}

/** The names inside `tauri::generate_handler![...]`, with any module path dropped. */
function registeredCommands(rust: string): Set<string> {
  const block = /generate_handler!\[([\s\S]*?)\]/.exec(rust)?.[1] ?? "";
  return new Set(
    block
      .split(",")
      .map((entry) => entry.trim().split("::").pop() ?? "")
      .filter((name) => /^[a-z][a-z0-9_]*$/.test(name)),
  );
}

describe("Tauri commands", () => {
  it("finds the registrations and the calls it checks", () => {
    const registered = registeredCommands(readFileSync(CORE, "utf8"));
    const invoked = invokedCommands(sourceFiles(SRC));
    expect(registered.size).toBeGreaterThan(20);
    expect(invoked.has("startup_get")).toBe(true);
    expect(invoked.has("shortcuts_register")).toBe(true);
  });

  it("every invoked name has a registered command", () => {
    const registered = registeredCommands(readFileSync(CORE, "utf8"));
    const missing = [...invokedCommands(sourceFiles(SRC))].filter(([name]) => !registered.has(name)).map(([name, file]) => `${name} (${file})`);
    expect(missing).toEqual([]);
  });

  it("parses module paths and both call styles", () => {
    expect([...registeredCommands("tauri::generate_handler![a_b, m::c_d,\n x::y::e ]")]).toEqual(["a_b", "c_d", "e"]);
    const sample = 'invoke("one"); invoke<Foo>("two", {}); call<readonly X[]>("three"); recall("no")';
    expect([...sample.matchAll(INVOKE)].map((m) => m[1])).toEqual(["one", "two", "three"]);
  });
});
