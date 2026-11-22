import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The built app's Content Security Policy, from `tauri.conf.json`, as a map of directive to its sources. */
function policy(): Map<string, readonly string[]> {
  const conf = JSON.parse(readFileSync(join(__dirname, "..", "src-tauri", "tauri.conf.json"), "utf8")) as {
    app: { security: { csp: string } };
  };
  return new Map(
    conf.app.security.csp
      .split(";")
      .map((directive) => directive.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...sources]) => [name ?? "", sources]),
  );
}

describe("the app's Content Security Policy", () => {
  const csp = policy();

  it("lets the voice-memo tile play its recordings, which are blob: URLs", () => {
    expect(csp.get("media-src")).toEqual(expect.arrayContaining(["'self'", "blob:"]));
  });

  it("loads images from the two custom schemes: wallpapers and dock icons", () => {
    expect(csp.get("img-src")).toEqual(
      expect.arrayContaining(["'self'", "http://dotdock-wallpaper.localhost", "http://dock-icon.localhost"]),
    );
  });

  it("reaches the core over IPC and nothing else on the network", () => {
    expect(csp.get("connect-src")).toEqual(["ipc:", "http://ipc.localhost"]);
    expect(csp.get("default-src")).toEqual(["'self'"]);
  });
});
