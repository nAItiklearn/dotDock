/**
 * Every user-visible product name and link on the site comes from this file.
 * The final product name is undecided: change it here and nowhere else.
 */
export const PRODUCT_NAME = "dotDock";

/** One line, used in the hero, the page title and social previews. */
export const TAGLINE = "Windows, in dots.";

export const REPO_URL = "https://github.com/nAItiklearn/dotDock";
export const RELEASES_URL = `${REPO_URL}/releases`;
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;
export const NOTICES_URL = `${REPO_URL}/blob/main/THIRD_PARTY_NOTICES.md`;
export const ISSUES_URL = `${REPO_URL}/issues`;
export const OPEN_METEO_URL = "https://open-meteo.com/";
export const WEBVIEW2_URL = "https://developer.microsoft.com/microsoft-edge/webview2/";
export const GPL_URL = "https://www.gnu.org/licenses/gpl-3.0.html";

/** In-site routes. Every page, the nav and the footer link through these. */
export const ROUTES = {
  home: "/",
  features: "/features",
  download: "/download",
  faq: "/faq",
  privacy: "/privacy",
  license: "/license",
  changelog: "/changelog",
} as const;

/**
 * The release the download page offers until tools/release-data.mjs has read it from GitHub: the version and the
 * two Windows assets the release workflow uploads. The links go through GitHub's latest-release redirect.
 */
export const NEXT_RELEASE = {
  releasesUrl: RELEASES_URL,
  version: "1.0.0",
  installer: "dotDock_1.0.0_x64-setup.exe",
  portable: "dotDock_1.0.0_x64-portable.exe",
} as const;

export const LICENSE_SPDX = "GPL-3.0-or-later";

/** Required wherever the project mentions what it is inspired by. Do not reword. */
export const DISCLAIMER =
  "Inspired by Nothing OS. Not affiliated with or endorsed by Nothing Technology Limited.";

/**
 * Absolute site URL for canonical, sitemap and social-card links. Set with the SITE_URL
 * environment variable at build time; unset means those tags are left out rather than guessed.
 */
export const SITE_URL: string | null = import.meta.env["SITE_URL"] ?? null;
