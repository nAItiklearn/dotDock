import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every Tauri command the TypeScript names must be registered in the core's `generate_handler!`. A name with no
 * command fails silently in the real app (the invoke rejects, the control does nothing), which is how most native
 * Settings pages ended up dead. Command names are snake_case string literals: they are read from every source file,
 * so commands reached through a wire table (`TILES_WIRE`, the island's `CMD`) or a helper (`call(name)`) count too.
 */

const SRC = join(__dirname);
const LIB_RS = join(__dirname, "..", "src-tauri", "src", "lib.rs");

/** snake_case literals in the sources that are data, not commands: the island feed's error kinds and Open-Meteo fields. */
const NOT_COMMANDS = new Set(["usage_limit", "model_not_found", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m"]);

/**
 * Names a track is still wiring into the core. Empty since the V1 integration merged the Settings, theme, dock and
 * release tracks; a name put here must still be missing, so the list only shrinks.
 */
const PENDING_IN_SETTINGS_TRACK: ReadonlySet<string> = new Set<string>();

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** Every snake_case string literal in the app's sources, with the files it appears in. */
function namedCommands(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of sources(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/["'`]([a-z][a-z0-9]*(?:_[a-z0-9]+)+)["'`]/g)) {
      const name = match[1];
      if (name === undefined || NOT_COMMANDS.has(name)) continue;
      found.set(name, [...(found.get(name) ?? []), relative(SRC, file)]);
    }
  }
  return found;
}

/** The command names in `generate_handler![...]`, without their module paths. */
function registeredCommands(lib: string): Set<string> {
  const list = lib.match(/generate_handler!\[([\s\S]*?)\]/);
  if (!list) throw new Error("no generate_handler! in lib.rs");
  return new Set(
    (list[1] ?? "")
      .split(",")
      .map((entry) => entry.trim().split("::").pop() ?? "")
      .filter((name) => name.length > 0),
  );
}

describe("native command names", () => {
  const registered = registeredCommands(readFileSync(LIB_RS, "utf8"));
  const named = namedCommands();

  it("reads the core's handler list", () => {
    expect(registered.has("dock_ready")).toBe(true);
    expect(registered.has("dock_tiles_watch")).toBe(true);
  });

  it("finds commands reached through wire tables and helpers", () => {
    expect(named.has("dock_tiles_watch")).toBe(true);
    expect(named.has("island_ready")).toBe(true);
    expect(named.has("wallpapers_list")).toBe(true);
  });

  it("has a registered core command for every name the TypeScript invokes", () => {
    const missing = [...named]
      .filter(([name]) => !registered.has(name) && !PENDING_IN_SETTINGS_TRACK.has(name))
      .map(([name, files]) => `${name} (${[...new Set(files)].join(", ")})`);
    expect(missing).toEqual([]);
  });

  it("keeps the Settings track's list to names the core still lacks and the TypeScript still uses", () => {
    const stale = [...PENDING_IN_SETTINGS_TRACK].filter((name) => registered.has(name) || !named.has(name));
    expect(stale).toEqual([]);
  });

  it("finds a name parsed from a handler list with module paths", () => {
    expect([...registeredCommands("generate_handler![a_b, host::c_d,\n e_f]")]).toEqual(["a_b", "c_d", "e_f"]);
  });
});
