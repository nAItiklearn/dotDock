# Website design system (binding for the redesign)

Owner direction (2026-11-20): define the font palette first, then colours, then the design, then the
imagery, and only then redesign; the look should be close to cooldock.app, whose type the owner loves.
Built in this order. Take the *taste* from CoolDock (clean, light, confident, product inside art), never
its assets, copy or layout pixel for pixel.

## 1. Font palette
Measured from cooldock.app's stylesheet (2026-11-20): `Inter Display` 800 for headlines with very tight
tracking (about -3 px at display sizes), `Inter` for text, `ui-monospace` for small labels.

| Role | Font | Weight | Size (desktop / mobile) | Tracking | Line height |
|---|---|---|---|---|---|
| Display (hero) | Inter Display (Inter 4, `opsz` axis) | 800 | 76 / 44 px | -0.045em | 0.95 |
| Heading (sections) | Inter Display | 800 | 52 / 34 px | -0.04em | 1.0 |
| Title (cards) | Inter Display | 700 | 22 / 20 px | -0.02em | 1.15 |
| Body | Inter | 400 | 18 / 16 px | -0.011em | 1.5 |
| Small | Inter | 500 | 14 px | -0.005em | 1.4 |
| Chip / label | Inter | 500 | 12.5 px | 0 | 1 |
| Field note (art captions, data) | Geist Mono | 500 | 11 px, uppercase | 0.12em | 1.3 |
| Brand and numerals | Doto (dot font) | 700 to 900 | wordmark and live widget numerals only | as drawn | 1 |

Rules: two families do almost everything (Inter Display for display, Inter for text). Doto is the brand
voice, used sparingly (wordmark, clock numerals in the product shot), never for paragraphs. Geist (sans)
leaves the website. Fonts are self-hosted WOFF2 subsets (Inter: SIL OFL 1.1, rsms/inter), licence
text in `website/public/licenses/`, recorded in THIRD_PARTY_NOTICES.md.

## 2. Colour palette
Light-first, like the reference: the art carries the colour; the interface stays neutral.

| Token | Paper (default) | Obsidian | Aurum | Use |
|---|---|---|---|---|
| `--bg` | #f6f5f2 | #0e0e0e | #0d0c0a | page |
| `--surface` | #ffffff | #171717 | #161411 | cards, chips |
| `--ink` | #0b0b0b | #f2f0ec | #f4efe4 | headlines, body |
| `--ink-2` | #5f5d59 | #a3a19d | #a8a293 | secondary text (>= 4.5:1 on `--bg`) |
| `--line` | rgba(0,0,0,0.08) | rgba(255,255,255,0.09) | rgba(255,240,210,0.10) | hairlines, chip borders |
| `--accent` | #e2363d | #e94248 | #e3b456 | the brand dot, primary button, focus |
| `--accent-ink` | #ffffff | #ffffff | #111111 | text on the accent |

One accent per theme, used only for the brand dot, the primary button and focus rings. No gradients in
the interface; gradients and colour live in the art. Contrast is checked by `website/tools/contrast.mjs`.

## 3. Design
- **Centred, generous, quiet.** Max content width 1120 px; hero text column 820 px. Section spacing
  160 px desktop, 96 px mobile. Radius 28 px on the hero art card, 18 px on cards, pills fully round.
- **Hero:** a small row of honest proof chips (Free and open source, No telemetry, Windows 10 and 11,
  In development); the display headline; one sentence of body; a row of feature chips; then the hero art
  card: a wide landscape image with the live desktop shot set inside it, the dock along its bottom.
- **Sections:** heading + one sentence + one strong visual each (widgets, the dock and categories, the
  island, themes, startup and safety). A two-column feature grid like CoolDock's "Apps, Files and Quick
  Access" cards, each with a real tile rendered in our style.
- **Footer:** a full-width landscape art strip with the links and the logo lockup set calmly above it.
- **Honesty:** no awards, ratings, testimonials or user counts we do not have. Real numbers only
  (startup ms from our measurements), labelled as from one laptop.
- **Motion:** gentle fade-and-rise on scroll (transform and opacity only), subtle parallax on the hero
  art, none under reduced motion.

## 4. Imagery
- Landscape and nature art in every hero and footer: meadows, misty ridges, wild flowers.
- Sources, in order: our own generated wallpapers and site art (`tools/wallpaper-gen`, `tools/site-art`);
  public-domain or CC0 photographs and paintings (Smithsonian Open Access, NASA, museum public-domain
  collections, Unsplash-licence only if recorded), each logged with creator, source URL and licence.
- The owner's Pinterest references are mood only: Pinterest grants no licence.
- Images: AVIF/WebP, 1x/2x, hero under ~350 KB at 1920 px, lazy below the fold.
