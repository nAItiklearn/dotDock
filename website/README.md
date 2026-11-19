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
