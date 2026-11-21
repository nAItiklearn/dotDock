import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES, type Theme } from "../../design-system/themes";
import { composite, contrastRatio, parseColor, type Rgba } from "../../lib/theme/color";
import { deriveColors } from "../../lib/theme/derive";
import { CAPTION_CONTRAST, CAPTION_INKS, captionInk, readInkInputs, type InkPalette } from "./ink";

const tokens = readFileSync(new URL("../../design-system/tokens.css", import.meta.url), "utf8");
const token = (name: string): string => new RegExp(`${name}:\\s*([^;]+);`).exec(tokens)?.[1]?.trim() ?? "";
const colour = (text: string): Rgba => {
  const c = parseColor(text);
  if (!c) throw new Error(`not a colour: ${text}`);
  return c;
};

const palette = Object.fromEntries(CAPTION_INKS.map((name) => [name, colour(token(name))])) as InkPalette;
/** The edge hairline's strength, as a fraction (the token is a percentage). */
const edgeMix = Number.parseFloat(token("--photo-edge-mix")) / 100;
/** A band's edge must stand apart from the band and from the desktop behind it by at least this much. */
const EDGE_FLOOR = 1.5;

type Tint = "paper" | "ink" | "dim" | "accent";
const TINTS: readonly Tint[] = ["paper", "ink", "dim", "accent"];

/** The border colour each tint resolves to in a theme, as PhotoWidget.css maps it. */
function lineOf(tint: Tint, theme: Pick<Theme["colors"], "textDim" | "accent">): Rgba {
  if (tint === "paper") return palette["--photo-mat"];
  if (tint === "ink") return palette["--photo-ink"];
  return colour(tint === "dim" ? theme.textDim : theme.accent);
}

const mix = (base: Rgba, top: Rgba, share: number): Rgba => composite({ ...top, a: share }, base);

/** Built-in themes plus palettes derived from accents all round the hue wheel, light and dark. */
function everyTheme(): { name: string; bg: Rgba; textDim: string; accent: string }[] {
  const themes = BUILTIN_THEMES.map((t) => ({ name: t.name, bg: colour(t.colors.bg), textDim: t.colors.textDim, accent: t.colors.accent }));
  for (let hue = 0; hue < 360; hue += 15) {
    for (const mode of ["light", "dark"] as const) {
      const accent = `#${[0, 120, 240]
        .map((shift) => Math.round(127.5 + 127.5 * Math.cos(((hue + shift) * Math.PI) / 180)).toString(16).padStart(2, "0"))
        .join("")}`;
      const derived = deriveColors(accent, mode);
      if (!derived) throw new Error(`could not derive ${accent}`);
      themes.push({ name: `${mode} ${accent}`, bg: colour(derived.bg), textDim: derived.textDim, accent: derived.accent });
    }
  }
  return themes;
}

describe("polaroid caption ink", () => {
  it("reaches body-text contrast on every border colour in every theme", () => {
    for (const theme of everyTheme()) {
      for (const tint of TINTS) {
        const line = lineOf(tint, theme);
        const ink = captionInk(line, theme.bg, palette);
        expect(contrastRatio(palette[ink], line), `${tint} in ${theme.name}`).toBeGreaterThanOrEqual(CAPTION_CONTRAST);
      }
    }
  });

  it("fixes the two Paper-theme captions that measured 4.35 and 4.34 : 1", () => {
    const paper = everyTheme().find((t) => t.name === "Paper");
    if (!paper) throw new Error("no Paper theme");
    const grey = lineOf("dim", paper);
    const accent = lineOf("accent", paper);
    expect(contrastRatio(palette[captionInk(grey, paper.bg, palette)], grey)).toBeGreaterThanOrEqual(CAPTION_CONTRAST);
    expect(contrastRatio(palette[captionInk(accent, paper.bg, palette)], accent)).toBeGreaterThanOrEqual(CAPTION_CONTRAST);
  });

  it("keeps the warm paper and ink pair wherever it is legible", () => {
    expect(captionInk(palette["--photo-mat"], palette["--photo-ink"], palette)).toBe("--photo-ink");
    expect(captionInk(palette["--photo-ink"], palette["--photo-mat"], palette)).toBe("--photo-mat");
  });

  it("holds for any opaque colour a custom theme could choose", () => {
    const backdrop = palette["--photo-ink"];
    for (let r = 0; r <= 255; r += 17) {
      for (let g = 0; g <= 255; g += 17) {
        for (let b = 0; b <= 255; b += 17) {
          const line = { r, g, b, a: 1 };
          expect(contrastRatio(palette[captionInk(line, backdrop, palette)], line)).toBeGreaterThanOrEqual(CAPTION_CONTRAST);
        }
      }
    }
  });

  it("measures a translucent border over the theme background", () => {
    const glassy = { r: 255, g: 255, b: 255, a: 0.1 };
    expect(captionInk(glassy, palette["--photo-ink"], palette)).toBe("--photo-mat");
  });

  it("reads resolved colours and gives up on one it cannot parse", () => {
    const values: Record<string, string> = { "--photo-line": "#6b6a66", "--bg": "rgba(232, 230, 227, 1)" };
    for (const name of CAPTION_INKS) values[name] = token(name);
    const style = { getPropertyValue: (name: string) => values[name] ?? "" } as unknown as CSSStyleDeclaration;
    expect(readInkInputs(style)?.line).toEqual(colour("#6b6a66"));
    values["--photo-line"] = "oklch(0.6 0.1 30)";
    expect(readInkInputs(style)).toBeNull();
  });
});

describe("band edge hairline", () => {
  it("gives a band as light or dark as the desktop an edge that stands apart from both", () => {
    for (const theme of BUILTIN_THEMES) {
      const bg = colour(theme.colors.bg);
      for (const tint of TINTS) {
        const band = lineOf(tint, theme.colors);
        const edge = mix(band, palette[captionInk(band, bg, palette)], edgeMix);
        const label = `${tint} in ${theme.name}`;
        // Where the band itself stands apart from the desktop it already has an edge.
        if (contrastRatio(band, bg) >= EDGE_FLOOR) continue;
        expect(contrastRatio(edge, band), label).toBeGreaterThanOrEqual(EDGE_FLOOR);
        expect(contrastRatio(edge, bg), label).toBeGreaterThanOrEqual(EDGE_FLOOR);
      }
    }
  });
});
