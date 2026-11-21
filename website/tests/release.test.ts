// The download page's switch between "not released yet" and a real release (src/lib/release.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { formatDate, formatSize, fromGitHub, releaseView, type GitHubRelease, type ReleaseData } from "../src/lib/release.ts";

const SHA = "3f2a9c0d4b1e6f7a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b";
const DATA: ReleaseData = {
  tag: "v1.0.0",
  url: "https://github.com/nAItiklearn/dotDock/releases/tag/v1.0.0",
  publishedAt: "2027-03-12T09:30:00Z",
  installer: {
    name: "dotDock_1.0.0_x64-setup.exe",
    url: "https://github.com/nAItiklearn/dotDock/releases/download/v1.0.0/dotDock_1.0.0_x64-setup.exe",
    bytes: 14_889_779,
    sha256: SHA,
  },
};

describe("releaseView", () => {
  it("shows the unreleased state while there is no release", () => {
    assert.deepEqual(releaseView(null), { state: "unreleased" });
  });

  it("shows the real version, size, checksum and download link of a release", () => {
    const v = releaseView(DATA);
    assert.equal(v.state, "released");
    if (v.state !== "released") return;
    assert.equal(v.version, "v1.0.0");
    assert.equal(v.size, "14.2 MB");
    assert.equal(v.sha256, SHA);
    assert.equal(v.downloadUrl, DATA.installer.url);
    assert.equal(v.pageUrl, DATA.url);
    assert.equal(v.fileName, "dotDock_1.0.0_x64-setup.exe");
    assert.equal(v.date, "12 March 2027");
    assert.equal(v.dateTime, "2027-03-12T09:30:00.000Z");
  });

  it("adds the v to a bare version number and lower-cases the checksum", () => {
    const v = releaseView({ ...DATA, tag: "1.2.3", installer: { ...DATA.installer, sha256: SHA.toUpperCase() } });
    assert.ok(v.state === "released" && v.version === "v1.2.3" && v.sha256 === SHA);
  });

  it("refuses a malformed checksum, size, link or date instead of showing it", () => {
    assert.throws(() => releaseView({ ...DATA, installer: { ...DATA.installer, sha256: "abc" } }), /SHA-256/);
    assert.throws(() => releaseView({ ...DATA, installer: { ...DATA.installer, bytes: 0 } }), /size/);
    assert.throws(() => releaseView({ ...DATA, installer: { ...DATA.installer, url: "http://example.invalid" } }), /Incomplete/);
    assert.throws(() => releaseView({ ...DATA, publishedAt: "soon" }), /date/);
  });
});

describe("formatting", () => {
  it("formats sizes in MB with one decimal and small files in KB", () => {
    assert.equal(formatSize(1024 * 1024), "1.0 MB");
    assert.equal(formatSize(831_488), "812 KB");
    assert.equal(formatSize(100), "1 KB");
  });
  it("formats the date in UTC", () => {
    assert.equal(formatDate("2027-01-01T00:30:00+02:00"), "31 December 2026");
  });
});

describe("fromGitHub", () => {
  const api: GitHubRelease = {
    tag_name: "v1.0.0",
    html_url: DATA.url,
    published_at: DATA.publishedAt,
    draft: false,
    prerelease: false,
    assets: [
      { name: "dotDock_1.0.0_x64_portable.zip", browser_download_url: "https://example.invalid/p.zip", size: 1, digest: `sha256:${"0".repeat(64)}` },
      { name: DATA.installer.name, browser_download_url: DATA.installer.url, size: DATA.installer.bytes, digest: `sha256:${SHA}` },
    ],
  };

  it("picks the setup installer and its GitHub digest", () => {
    assert.deepEqual(fromGitHub(api), DATA);
  });
  it("keeps the unreleased state for drafts, pre-releases and installers without a checksum", () => {
    assert.equal(fromGitHub({ ...api, draft: true }), null);
    assert.equal(fromGitHub({ ...api, prerelease: true }), null);
    assert.equal(fromGitHub({ ...api, assets: api.assets.map((a) => ({ ...a, digest: null })) }), null);
    assert.equal(fromGitHub({ ...api, assets: [] }), null);
  });
});

describe("src/data/release.json", () => {
  it("is null or a release the page can show", () => {
    const data = JSON.parse(readFileSync(new URL("../src/data/release.json", import.meta.url), "utf8")) as ReleaseData | null;
    assert.doesNotThrow(() => releaseView(data));
  });
});
