// The changelog page's version states (src/lib/changelog.ts) and its content (src/data/changelog.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { majorOf, versionStatus, type Version } from "../src/lib/changelog.ts";
import { releaseView, type ReleaseData } from "../src/lib/release.ts";
import { FIRST_VERSION, VERSIONS } from "../src/data/changelog.ts";

const NEXT = {
  releasesUrl: "https://github.com/nAItiklearn/dotDock/releases",
  version: "1.0.0",
  installer: "dotDock_1.0.0_x64-setup.exe",
  portable: "dotDock_1.0.0_x64-portable.exe",
};

const v = (major: number): Version => ({ major, name: `Version ${major}`, summary: "", groups: [] });
const released = (tag: string): ReleaseData => ({
  tag,
  url: `https://github.com/nAItiklearn/dotDock/releases/tag/${tag}`,
  publishedAt: "2027-03-12T09:30:00Z",
  installer: {
    name: "dotDock_x64-setup.exe",
    url: `https://github.com/nAItiklearn/dotDock/releases/download/${tag}/dotDock_x64-setup.exe`,
    bytes: 14_889_779,
    sha256: "3f2a9c0d4b1e6f7a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b",
  },
});

describe("versionStatus", () => {
  it("before the release data is read, the announced version is out and the next is in testing, with no date", () => {
    const announced = releaseView(null, NEXT);
    assert.deepEqual(versionStatus(v(1), announced, 1), { state: "out", tag: "v1.0.0", pageUrl: "https://github.com/nAItiklearn/dotDock/releases/latest" });
    assert.deepEqual(versionStatus(v(2), announced, 1), { state: "in-testing" });
    assert.deepEqual(versionStatus(v(3), announced, 1), { state: "planned" });
  });

  it("takes the date and the notes link from the published release", () => {
    const s = versionStatus(v(1), releaseView(released("v1.0.2"), NEXT), 1);
    assert.equal(s.state, "released");
    if (s.state !== "released") return;
    assert.equal(s.tag, "v1.0.2");
    assert.equal(s.dateTime, "2027-03-12T09:30:00.000Z");
    assert.equal(s.pageUrl, "https://github.com/nAItiklearn/dotDock/releases/tag/v1.0.2");
  });

  it("moves the next version into testing once a release is out, and marks older ones released", () => {
    const r = releaseView(released("v2.1.0"), NEXT);
    assert.deepEqual(versionStatus(v(1), r, 1), { state: "earlier" });
    assert.deepEqual(versionStatus(v(3), r, 1), { state: "in-testing" });
    assert.deepEqual(versionStatus(v(4), r, 1), { state: "planned" });
  });

  it("reads the major version of a tag", () => {
    assert.equal(majorOf("v12.0.1"), 12);
    assert.equal(majorOf("nightly"), null);
  });
});

describe("changelog content", () => {
  it("lists every version once, in order from the first", () => {
    const majors = VERSIONS.map((x) => x.major);
    assert.deepEqual(majors, [...majors].sort((a, b) => a - b));
    assert.equal(new Set(majors).size, majors.length);
    assert.equal(majors[0], FIRST_VERSION);
  });

  it("has no empty version, group or line", () => {
    for (const x of VERSIONS) {
      assert.ok(x.summary.length > 0 && x.groups.length > 0, x.name);
      for (const g of x.groups) {
        assert.ok(g.title.length > 0 && g.items.length > 0, `${x.name}: ${g.title}`);
        for (const item of g.items) assert.match(item, /^[A-Z].*\.$/, `${x.name}: ${item}`);
      }
    }
  });
});
