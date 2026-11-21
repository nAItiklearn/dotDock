/**
 * The changelog page's versions. Each version lists what it really contains; whether it is out comes from the
 * published release in src/data/release.json (tools/release-data.mjs), never from a date typed here. A planned
 * version has no date at all.
 */
import type { ReleaseView } from "./release";

export interface ChangeGroup {
  /** The part of the environment, for example "The dock". */
  readonly title: string;
  readonly items: readonly string[];
}

export interface Version {
  /** The major version, matched against the tag of the published release ("v1.0.0" is version 1). */
  readonly major: number;
  readonly name: string;
  readonly summary: string;
  readonly groups: readonly ChangeGroup[];
}

/** How a version shows on the page. */
export type VersionStatus =
  | { readonly state: "released"; readonly tag: string; readonly date: string; readonly dateTime: string; readonly pageUrl: string }
  | { readonly state: "earlier" }
  | { readonly state: "in-testing" }
  | { readonly state: "planned" };

const TAG = /^v(\d+)\./;

/** The major version of a release tag, or null when the tag is not a version. */
export function majorOf(tag: string): number | null {
  const m = TAG.exec(tag);
  return m ? Number(m[1]) : null;
}

/**
 * The version of the latest published release is released, with its date; an older one came out before it. The
 * version after it (or the first version, before any release) is being built and tested; anything later is planned.
 */
export function versionStatus(version: Version, release: ReleaseView, first: number): VersionStatus {
  const latest = release.state === "released" ? majorOf(release.version) : null;
  if (release.state === "released" && version.major === latest) {
    return { state: "released", tag: release.version, date: release.date, dateTime: release.dateTime, pageUrl: release.pageUrl };
  }
  if (latest !== null && version.major < latest) return { state: "earlier" };
  const next = latest === null ? first : latest + 1;
  return version.major === next ? { state: "in-testing" } : { state: "planned" };
}
