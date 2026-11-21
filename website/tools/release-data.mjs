// Writes src/data/release.json from the latest GitHub release of the repository, so the download page shows
// the real version, installer size and SHA-256. Writes `null` when there is no published release yet.
// Usage: node tools/release-data.mjs            (reads GITHUB_TOKEN if set, to avoid the anonymous rate limit)
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fromGitHub, releaseView } from "../src/lib/release.ts";

const REPO = "nAItiklearn/dotDock";
const out = join(import.meta.dirname, "..", "src", "data", "release.json");
const headers = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers });
let data = null;
if (res.ok) data = fromGitHub(await res.json());
else if (res.status !== 404) throw new Error(`GitHub answered ${res.status} for the latest release of ${REPO}`);

if (data) releaseView(data, { releasesUrl: `https://github.com/${REPO}/releases`, version: "", installer: "", portable: "" }); // fails here, before writing, if the release is malformed
writeFileSync(out, `${JSON.stringify(data, null, 1)}\n`);
console.log(data ? `release.json: ${data.tag}, ${data.installer.name}` : "release.json: no published release");
