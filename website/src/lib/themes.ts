/**
 * Origin: copied from apps/desktop/src/design-system/themes.ts so the page re-themes with the
 * product's real tokens. Copied, not imported, because the website is a separate app.
 * Differences from the product, kept to what the web needs:
 *  - `accentText`: the accent used as small text must reach 4.5:1 contrast (WCAG AA); the plain
 *    accent stays for dots, rings and large shapes.
 *  - Paper `textDim` and `accent` are one notch deeper (accent #e2363d to #da3038) so white text on
 *    the accent also passes. Obsidian `accentInk` is the charcoal ink for the same reason.
 *  - `themeCss()` turns the tokens into CSS variables at build time; there is no runtime theme code.
 * `tools/contrast.mjs` fails the build if a pairing drops below its threshold.
 */

/** Theme token sets. Every colour on screen comes from one of these roles. */
export interface ThemeColors {
  readonly bg: string;
  readonly surface: string;
  readonly surface2: string;
  readonly border: string;
  readonly text: string;
  readonly textDim: string;
  readonly accent: string;
  readonly accentText: string;
  readonly accentInk: string;
  readonly dotOn: string;
  readonly dotOff: string;
  readonly danger: string;
  readonly success: string;
  readonly shadow: string;
}

export type ThemeId = "obsidian" | "paper" | "aurum";

export interface Theme {
  readonly id: ThemeId;
  readonly name: string;
  readonly mode: "light" | "dark";
  /** One line shown on the theme cards. */
  readonly blurb: string;
  readonly colors: ThemeColors;
}

export const OBSIDIAN: Theme = {
  id: "obsidian",
  name: "Obsidian",
  mode: "dark",
  blurb: "Charcoal, warm white, one red.",
  colors: {
    bg: "#111111",
    surface: "rgba(22, 22, 22, 0.86)",
    surface2: "#1c1c1c",
    border: "rgba(255, 255, 255, 0.07)",
    text: "#e8e6e3",
    textDim: "#8a8a86",
    accent: "#e94248",
    accentText: "#f16d70",
    accentInk: "#111111",
    dotOn: "#e8e6e3",
    dotOff: "rgba(232, 230, 227, 0.14)",
    danger: "#f16d70",
    success: "#9eae96",
    shadow: "0 12px 32px rgba(0, 0, 0, 0.35)",
  },
};

export const PAPER: Theme = {
  id: "paper",
  name: "Paper",
  mode: "light",
  blurb: "Warm off-white, black ink, one red.",
  colors: {
    bg: "#e8e6e3",
    surface: "rgba(245, 244, 241, 0.92)",
    surface2: "#dcdad6",
    border: "rgba(17, 17, 17, 0.06)",
    text: "#111111",
    textDim: "#5f5e5a",
    accent: "#da3038",
    accentText: "#b02026",
    accentInk: "#ffffff",
    dotOn: "#da3038",
    dotOff: "rgba(17, 17, 17, 0.12)",
    danger: "#c42b31",
    success: "#5f7a55",
    shadow: "0 10px 28px rgba(17, 17, 17, 0.12)",
  },
};

export const AURUM: Theme = {
  id: "aurum",
  name: "Aurum",
  mode: "dark",
  blurb: "Near-black with a single gold.",
  colors: {
    bg: "#0c0c0c",
    surface: "rgba(18, 17, 15, 0.86)",
    surface2: "#1c1a16",
    border: "rgba(232, 200, 120, 0.10)",
    text: "#f5f4f1",
    textDim: "#a3a19d",
    accent: "#e2b453",
    accentText: "#e2b453",
    accentInk: "#111111",
    dotOn: "#e2b453",
    dotOff: "rgba(226, 180, 83, 0.16)",
    danger: "#f16d70",
    success: "#9eae96",
    shadow: "0 12px 32px rgba(0, 0, 0, 0.4)",
  },
};

export const THEMES: readonly Theme[] = [OBSIDIAN, PAPER, AURUM];
/** localStorage key holding the visitor's chosen theme id. */
export const THEME_STORAGE_KEY = "dotdock-theme";
export const DEFAULT_THEME: ThemeId = "obsidian";
/** Theme used when the visitor's system asks for a light interface and has not chosen one. */
export const LIGHT_PREFERENCE_THEME: ThemeId = "paper";

const CSS_VAR: Record<keyof ThemeColors, string> = {
  bg: "--bg",
  surface: "--surface",
  surface2: "--surface-2",
  border: "--border",
  text: "--text",
  textDim: "--text-dim",
  accent: "--accent",
  accentText: "--accent-text",
  accentInk: "--accent-ink",
  dotOn: "--dot-on",
  dotOff: "--dot-off",
  danger: "--danger",
  success: "--success",
  shadow: "--shadow",
};

/**
 * Builds the theme stylesheet. Rules use a plain attribute selector so any element carrying
 * data-theme re-themes its own subtree (the theme cards rely on this).
 */
export function themeCss(): string {
  return THEMES.map((theme) => {
    const vars = (Object.keys(CSS_VAR) as (keyof ThemeColors)[])
      .map((key) => `${CSS_VAR[key]}:${theme.colors[key]}`)
      .join(";");
    return `[data-theme="${theme.id}"]{${vars};color-scheme:${theme.mode}}`;
  }).join("");
}

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}
