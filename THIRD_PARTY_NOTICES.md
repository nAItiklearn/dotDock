# Third-party notices

Every dependency, font, sound, image and data source is listed here with its licence. Nothing is added without an entry.

## Fonts (shipped in `assets/web/fonts`, subset to Latin, WOFF2)
| Font | Copyright | Licence |
|---|---|---|
| Doto | The Doto Project Authors (github.com/oliverlalan/Doto) | SIL Open Font License 1.1 (`assets/web/fonts/Doto-OFL.txt`) |
| Geist | The Geist Project Authors (github.com/vercel/geist-font) | SIL Open Font License 1.1 (`assets/web/fonts/Geist-OFL.txt`) |
| Geist Mono | The Geist Project Authors (github.com/vercel/geist-font) | SIL Open Font License 1.1 (`assets/web/fonts/GeistMono-OFL.txt`) |
| Inter and Inter Display (website only) | The Inter Project Authors (github.com/rsms/inter, release 4.1) | SIL Open Font License 1.1 (`website/public/licenses/Inter-OFL.txt`) |

## Data
- **Weather data by [Open-Meteo.com](https://open-meteo.com/)**, licensed CC BY 4.0. Forecast and geocoding APIs, used only after the user picks a place.

## Wallpapers and icons
- All wallpapers in `assets/wallpapers` are original, generated from code and fixed seeds by `tools/wallpaper-gen` (GPL-3.0-or-later, part of this project). No third-party images; where a style was inspired by an owner-supplied mood image, that image was only looked at and never used as input (see `docs/DECISIONS.md` D-015).
- The logo mark, app icon, favicon and social preview are original, drawn from code by `tools/brand-gen` (GPL-3.0-or-later, part of this project). The mark is a dot and a pill; it copies no existing logo, glyph set or typeface.
- The wordmark is the product name set in Doto (SIL OFL 1.1, above), cut into one SVG circle per dot so it needs no font. Tagline and captions on the brand artwork are Geist and Geist Mono (SIL OFL 1.1, above) outlined to paths. The OFL allows this; the outlines are not a font.

## Rust crates (direct dependencies)
| Crate | Licence |
|---|---|
| tauri, tauri-build, tauri-plugin-single-instance | MIT OR Apache-2.0 |
| windows | MIT OR Apache-2.0 |
| sysinfo | MIT |
| serde, serde_json | MIT OR Apache-2.0 |
| thiserror | MIT OR Apache-2.0 |
| base64 | MIT OR Apache-2.0 |
| ureq | MIT OR Apache-2.0 |

Transitive crate licences are checked by `cargo audit` in CI; a full generated list ships with releases.

## npm packages (direct dependencies, `apps/desktop`)
| Package | Licence |
|---|---|
| react, react-dom | MIT |
| zustand | MIT |
| motion | MIT |
| @tauri-apps/api, @tauri-apps/cli | MIT OR Apache-2.0 |
| vite, @vitejs/plugin-react, vitest | MIT |
| typescript | Apache-2.0 |
| @types/react, @types/react-dom, @types/node | MIT |

## Build-time tools (not shipped)
- Python packages used by `tools/wallpaper-gen`: numpy (BSD-3-Clause), Pillow (MIT-CMU / HPND), opencv-python (Apache-2.0).
- Python packages used by `tools/brand-gen`: Pillow (MIT-CMU / HPND), resvg-py (MIT, wraps the resvg renderer, MPL-2.0), fontTools (MIT), Brotli (MIT), uharfbuzz (Apache-2.0, wraps HarfBuzz, MIT).
- fontTools (MIT) for font subsetting.

## Design references (not shipped, not in the repository)
- Colour values are taken from the Omarchy NThing theme by Ninnix (MIT), https://github.com/Ninnix/omarchy-nthing-theme. Hex colours are facts, not copyrightable assets; no files from that repository are included.

## Bundled content (widgets)
- Quotes (`apps/desktop/src/widgets/data/quotes.ts`): short texts by authors who died before 1930, with the translation, translator and year named in each entry (Gummere 1917, Long 1862, Carter 1758, Legge 1861 and 1891, Townsend 1867, Adams 1849). All are in the public domain. Users can add their own list.
- Facts (`apps/desktop/src/widgets/data/facts.ts`): our own wording of facts, each naming the source it can be checked against. Facts are not copyrightable; no source text is reproduced.
- Timer chime: synthesised at runtime with the Web Audio API. There is no audio file.
- Dot-matrix glyphs, pictograms and line icons are original drawings made for this project.
- City coordinates and time zones (`apps/desktop/src/widgets/data/cities.ts`) are factual data; offsets and daylight saving come from the platform's IANA database via `Intl`.

## Agent Island: design and protocol derived from Agent Island (MIT)

The Agent Island feature (`apps/desktop/src-tauri/island/`, `island-hook/`, `apps/desktop/src/island/`) is a Windows port of the design and protocol of **Agent Island** by Jean, https://github.com/1413jean/agent-island (MIT, Swift/macOS). No source files, art or sounds were copied; the Rust and TypeScript code is written from scratch. The following behaviour is closely derived from it, so its licence notice is kept:

- the per-session state-file protocol and which hook events feed it,
- classification of interruptions, usage limits and API errors from the Claude Code transcript,
- per-turn token counting de-duplicated by message id,
- the mapping of Codex rollout log events to session states,
- the Connect / Disconnect rule of adding and removing only the app's own hook entries after a backup.

```
MIT License

Copyright (c) 2026 Jean

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Not reused from Agent Island: its cat and orb artwork, its sounds (UI SFX, CC0) and the Sparkle updater. The island's dot-matrix state icons and its three chimes are original; the chimes are synthesised at run time and need no audio files.

## Dependencies added for Agent Island

| Crate | Used for | Licence |
| --- | --- | --- |
| `notify` 8 (and `notify-types`) | file-system watcher for the session folder and logs | CC0-1.0 (`notify`), MIT OR Apache-2.0 (`notify-types`) |
| `tempfile` (dev only) | temporary folders in unit tests | MIT OR Apache-2.0 |
| `walkdir`, `same-file`, `winapi-util` (via `notify`) | directory traversal helpers | Unlicense OR MIT |

`serde`, `serde_json`, `thiserror` and `windows` are already used by the shell crate and are unchanged. `serde_json` is built with its `preserve_order` feature so Connect keeps the key order of the user's `settings.json`.

## Dock backend (`apps/desktop/src-tauri/dock/`)

| Crate | Used for | Licence |
| --- | --- | --- |
| `png` 0.18 (and its `fdeflate`, `miniz_oxide`, `crc32fast`, `bitflags`) | encoding the 256 px icon cache and decoding the logo files of Store packages; already in the tree through `tauri` | MIT OR Apache-2.0 |
| `notify` 8, `tempfile` (dev), `serde`, `serde_json`, `thiserror`, `windows` | as listed above | as listed above |

No icon, art, code or table is taken from another dock, launcher or Start menu replacement. The bundled table of well-known apps
(`dock/src/classify/known.rs`) lists app names, executable names and AppUserModelID prefixes, which are facts, written by hand for this
project. The icons shown in the dock are extracted at run time from the user's own installed apps and stay on the user's machine
(`%LOCALAPPDATA%\dev.dotdock.desktop\dock-icons`); none is shipped or committed.


## Website (`website/`)
The showcase site is a static Astro project. These packages are build-time only; the published site is plain HTML, CSS and one small script bundle. It loads no third-party scripts, fonts, analytics or CDNs.

| Package | Licence |
|---|---|
| astro | MIT |
| @astrojs/check | MIT |
| typescript | Apache-2.0 |
| sharp (used by hand in `website/tools/make-wallpapers.mjs`, not at build or runtime) | Apache-2.0 (prebuilt binaries include libvips, LGPL-3.0-or-later) |

Transitive package licences are pinned by `website/pnpm-lock.yaml`.

- Fonts: Doto and Geist Mono as above, plus Inter 4.1 (Inter 400 and 500 for text, Inter Display 700 and 800 for headlines), subset to Latin by `tools/site-art/subset_fonts.py` (fontTools, MIT, and brotli, MIT; build-time only). The files are in `website/src/assets/fonts`, their OFL texts in `website/public/licenses`. The website no longer uses Geist (sans); that face stays only in the outlined brand artwork above.
- Site art: the dot landscapes, pixel flowers and grass on the website are generated from code and fixed seeds by `tools/site-art` (GPL-3.0-or-later, part of this project; numpy, Pillow and opencv as in `tools/wallpaper-gen`). They are original; the owner's mood images were only looked at, never used as input.
- Navigation icon: the GitHub mark (Invertocat) in the header is the unmodified mark published by GitHub at https://github.com/logos, used under GitHub's logo and usage guidelines to link to this project's repository on GitHub. It is a trademark of GitHub, Inc.; the project is not affiliated with or endorsed by GitHub.
- Wallpapers: downscaled WebP copies of three of the original wallpapers in `assets/wallpapers`, made by `website/tools/make-wallpapers.mjs`. Original, GPL-3.0-or-later like the rest of the project.
- Theme tokens and dot-matrix glyph geometry are copied from `apps/desktop/src/design-system` (this project's own code).

---
Inspired by Nothing OS. Not affiliated with or endorsed by Nothing Technology Limited.
