/**
 * The download page's release data. `src/data/release.json` holds the latest published release, or `null`
 * while none exists; `tools/release-data.mjs` writes it from the GitHub Releases API, so the version, size
 * and checksum on the page always come from a real release and are never typed by hand.
 */

/** One published release, as written to src/data/release.json. */
export interface ReleaseData {
  /** Git tag, for example "v1.0.0". */
  readonly tag: string;
  /** The release page on GitHub. */
  readonly url: string;
  /** ISO 8601 publish time. */
  readonly publishedAt: string;
  /** The Windows installer asset. */
  readonly installer: {
    readonly name: string;
    readonly url: string;
    readonly bytes: number;
    /** Lower-case hex SHA-256 of the installer. */
    readonly sha256: string;
  };
}

/** What the download page shows. */
export type ReleaseView =
  | { readonly state: "unreleased" }
  | {
      readonly state: "released";
      readonly version: string;
      readonly pageUrl: string;
      readonly downloadUrl: string;
      readonly fileName: string;
      readonly size: string;
      readonly sha256: string;
      readonly date: string;
      readonly dateTime: string;
    };

const SHA256 = /^[0-9a-f]{64}$/;
const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * BYTES_PER_KB;

/** "14.2 MB", "812 KB": one decimal for megabytes, whole kilobytes below one megabyte. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) throw new Error(`Invalid installer size: ${bytes}`);
  if (bytes >= BYTES_PER_MB) return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / BYTES_PER_KB))} KB`;
}

/** "12 March 2027", in UTC so the build machine's time zone never changes the page. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid release date: ${iso}`);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

/**
 * The page model for a release, or the unreleased state for `null`. A release with a missing or malformed
 * field fails the build instead of showing a wrong checksum or size.
 */
export function releaseView(data: ReleaseData | null): ReleaseView {
  if (data === null) return { state: "unreleased" };
  const { tag, url, publishedAt, installer } = data;
  if (!tag || !url?.startsWith("https://") || !installer?.url?.startsWith("https://") || !installer.name) {
    throw new Error(`Incomplete release data for ${tag || "unknown tag"}`);
  }
  const sha256 = String(installer.sha256).toLowerCase();
  if (!SHA256.test(sha256)) throw new Error(`Invalid SHA-256 for ${tag}: ${installer.sha256}`);
  return {
    state: "released",
    version: tag.startsWith("v") ? tag : `v${tag}`,
    pageUrl: url,
    downloadUrl: installer.url,
    fileName: installer.name,
    size: formatSize(installer.bytes),
    sha256,
    date: formatDate(publishedAt),
    dateTime: new Date(publishedAt).toISOString(),
  };
}

/** GitHub's REST shape for a release, reduced to what `fromGitHub` reads. */
export interface GitHubRelease {
  readonly tag_name: string;
  readonly html_url: string;
  readonly published_at: string | null;
  readonly draft: boolean;
  readonly prerelease: boolean;
  readonly assets: ReadonlyArray<{
    readonly name: string;
    readonly browser_download_url: string;
    readonly size: number;
    /** "sha256:<hex>", set by GitHub on uploaded assets. */
    readonly digest?: string | null;
  }>;
}

/** The installer is the per-user NSIS setup, named "...-setup.exe" by the Tauri bundler. */
export function isInstaller(name: string): boolean {
  return /-setup\.exe$/i.test(name);
}

/**
 * Turns the GitHub API's latest release into release.json data, or `null` when it has no installer with a
 * checksum (a draft, a pre-release, or one still uploading): the page then keeps its unreleased state.
 */
export function fromGitHub(release: GitHubRelease): ReleaseData | null {
  if (release.draft || release.prerelease || !release.published_at) return null;
  const asset = release.assets.find((a) => isInstaller(a.name));
  const digest = asset?.digest?.startsWith("sha256:") ? asset.digest.slice("sha256:".length) : null;
  if (!asset || !digest) return null;
  return {
    tag: release.tag_name,
    url: release.html_url,
    publishedAt: release.published_at,
    installer: { name: asset.name, url: asset.browser_download_url, bytes: asset.size, sha256: digest.toLowerCase() },
  };
}
