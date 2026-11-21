# dotDock website

Static showcase site. Pages: `/` (home), `/download`, `/faq`, `/privacy`, `/license`.

```
pnpm install
pnpm build      # sync notices, contrast check, astro check (TypeScript strict), astro build -> dist/
pnpm dev        # http://localhost:4321
pnpm preview    # serve dist/
```

Nothing here deploys anywhere. Set `SITE_URL` at build time to emit canonical and social-card URLs; unset, they are left out rather than guessed. The site assumes it is served from the domain root.

## Stack: Astro 7, not Vite + React

The site is almost all static content with small islands of behaviour. Astro renders it to plain HTML at build time (text paints immediately, good for LCP and SEO), ships about 20 KB of script in total and no framework runtime. The widget visuals reuse the product's own geometry (`DotMatrix`, glyphs) as build-time Astro components, so numerals cost zero client JS. TypeScript is strict (`astro/tsconfigs/strictest`, with `noUncheckedIndexedAccess` off for typed-array code in `lib`). `@astrojs/check` needs TypeScript 5 or 6, so the site pins TypeScript 6.

## One name

`src/brand.ts` holds the product name, tagline, repo and route constants. `LATEST_RELEASE` is `null` until a release exists (check with `gh release list -R nAItiklearn/dotDock`); every download surface reads it and no version string is ever invented.

## Design system

Copied (not imported) from `apps/desktop/src/design-system`, with the origin noted in each file: `src/lib/themes.ts` (tokens, plus `accentText` and a slightly deeper Paper so text passes WCAG AA; `tools/contrast.mjs` fails the build otherwise), `glyphs.ts`, `matrixGeometry.ts`. Fonts (Doto, Geist, Geist Mono, SIL OFL) are self-hosted from `src/assets/fonts`, preloaded, `font-display: swap` with metric-matched fallback faces.

Widgets: `src/components/Widget.astro` draws every widget; `src/scripts/live.ts` makes the clock, date, calendar, battery (Battery Status API where the browser offers it) and the timer live. RAM, disk, weather, forecast and to-do are static samples and are labelled as such. Wallpapers are downscaled WebP copies of three original wallpapers; regenerate with `node tools/make-wallpapers.mjs <path to assets/wallpapers>`.

## Adding the product video

The home page has a slot for it (`src/components/ProductVideo.astro`), currently an animated dot-matrix poster marked "coming soon". To publish:

1. Put an H.264 MP4 and a poster image in `public/video/`.
2. Set `PRODUCT_VIDEO` in `src/video.ts` (`src`, `poster`, `label`, optional `captions` WebVTT).

The same frame then holds a native `<video controls preload="none">`. No other change is needed.

## Licence pages

`/license` renders `src/content/THIRD_PARTY_NOTICES.md`, copied from the repository's `THIRD_PARTY_NOTICES.md` by `tools/sync-notices.mjs` on every build (kept as-is when built outside the repo).

## Local preview

The site is built for Vercel (static pages plus one on-demand route, `/api/visits`), and Astro's own `preview` does not support the Vercel adapter. After `pnpm build`, run `pnpm preview`: `tools/preview.mjs` serves `.vercel/output/static` and `/api/visits` with the same code the deployed route uses (default port 4330).

## Visit counter

A small, anonymous count in the footer. Code: `src/lib/visits.ts` (logic, no imports), `src/pages/api/visits.ts` (the route), `src/scripts/visits.ts` (the page).

- **Storage:** one Redis number, `dotdock:visits`, in Upstash Redis. Add it from the Vercel Marketplace (Storage, Upstash Redis) and connect it to the project; that sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`. A database made directly on Upstash uses `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`; either pair works (the KV pair wins when both are set).
- **Counting:** a browser that has not counted today sends `POST /api/visits` (adds one); every other page view sends `GET` (reads). The browser keeps only the date of its last count in `localStorage` (`dotdock-visit-day`). No IP address, cookie or identifier is stored, and nothing else is sent.
- **Not configured:** without credentials, `/api/visits` answers `503` and the footer line stays hidden. If Redis fails it answers `502`. A number is only ever shown when the server returned it.
- **Tests:** `pnpm test` runs `tests/visits.test.ts` with a mocked Redis client (credential pairs, increment, read, 503, 405, 502, response headers); it also runs in `pnpm build`.
- **Try it end to end without an account:** after `pnpm build`, `bash tools/try-visits.sh` starts `tools/fake-upstash.mjs` (a stand-in for the Upstash REST API) and the preview server and shows increment and read over HTTP:

```text
with credentials (KV_REST_API_URL / KV_REST_API_TOKEN):
GET    {"visits":0}  -> 200
POST   {"visits":1}  -> 200
POST   {"visits":2}  -> 200
POST   {"visits":3}  -> 200
GET    {"visits":3}  -> 200
DELETE {"error":"method not allowed"}  -> 405
without credentials:
GET    {"error":"counter not configured"}  -> 503
POST   {"error":"counter not configured"}  -> 503
```

## Videos

Three optional recordings of the real app: `tour` (home page, under the hero), `dock` and `notch` (Features page). Put `<name>.mp4` (H.264) and `<name>-poster.webp` in `public/video/` (and optionally `<name>.vtt` captions) and rebuild; the slot appears on its own. Until the files exist nothing is rendered. They load nothing until played (`preload="none"`). The cuts are described in `docs/design/LAUNCH_VIDEO.md`.

## Art

All pictures come from `tools/site-art` (Python, numpy, Pillow, OpenCV): `python -I tools/site-art/generate.py [--only name,...] [--scales 1,2]` writes WebP masks and `src/assets/art/manifest.json`. Pieces: `scape` (hero hills), `bouquet-left/right` and `tuft-left/right` (hero flowers), `scene-*` (backdrops of the Features page shots), `band-*` (full-width pictures between sections) and `meadow` (footer). Art stands beside or between content and never behind text. Bands, scenes and the meadow load as they near the screen.
