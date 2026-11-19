# Third-party notices

Every dependency, font, sound, image and data source is listed here with its licence. Nothing is added without an entry.

## Fonts (shipped in `assets/web/fonts`, subset to Latin, WOFF2)
| Font | Copyright | Licence |
|---|---|---|
| Doto | The Doto Project Authors (github.com/oliverlalan/Doto) | SIL Open Font License 1.1 (`assets/web/fonts/Doto-OFL.txt`) |
| Geist | The Geist Project Authors (github.com/vercel/geist-font) | SIL Open Font License 1.1 (`assets/web/fonts/Geist-OFL.txt`) |
| Geist Mono | The Geist Project Authors (github.com/vercel/geist-font) | SIL Open Font License 1.1 (`assets/web/fonts/GeistMono-OFL.txt`) |

## Data
- **Weather data by [Open-Meteo.com](https://open-meteo.com/)**, licensed CC BY 4.0. Forecast and geocoding APIs, used only after the user picks a place.

## Wallpapers and icons
- All wallpapers in `assets/wallpapers` are original, generated from code and fixed seeds by `tools/wallpaper-gen` (GPL-3.0-or-later, part of this project). No third-party images.
- The app icon is original, drawn by `tools/icon-gen/make_icon.py`.

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
- Python packages used by `tools/wallpaper-gen` and `tools/icon-gen`: numpy (BSD-3-Clause), Pillow (MIT-CMU / HPND), opencv-python (Apache-2.0).
- fontTools (MIT) for font subsetting.

## Design references (not shipped, not in the repository)
- Colour values are taken from the Omarchy NThing theme by Ninnix (MIT), https://github.com/Ninnix/omarchy-nthing-theme. Hex colours are facts, not copyrightable assets; no files from that repository are included.

---
Inspired by Nothing OS. Not affiliated with or endorsed by Nothing Technology Limited.
