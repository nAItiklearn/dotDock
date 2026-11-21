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
  | { readonly state: "out"; readonly tag: string; readonly pageUrl: string }
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
 * The version of the latest release is out: with its date once tools/release-data.mjs has read it, or as the
 * announced version before that. An older one came out before it. The version after it (or the first version,
 * when there is none) is being built and tested; anything later is planned.
 */
export function versionStatus(version: Version, release: ReleaseView, first: number): VersionStatus {
  const latest = majorOf(release.version);
  if (version.major === latest) {
    return release.state === "released"
      ? { state: "released", tag: release.version, date: release.date, dateTime: release.dateTime, pageUrl: release.pageUrl }
      : { state: "out", tag: release.version, pageUrl: release.pageUrl };
  }
  if (latest !== null && version.major < latest) return { state: "earlier" };
  const next = latest === null ? first : latest + 1;
  return version.major === next ? { state: "in-testing" } : { state: "planned" };
}
