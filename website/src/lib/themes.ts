/**
 * Website theme tokens. They started as a copy of apps/desktop/src/design-system/themes.ts and now follow
 * docs/design/WEBSITE_SYSTEM.md (light-first: Paper is the default, the art carries the colour).
 * The role names are the product's; the values are the website's:
 *  - `surface2` is the card colour of the table (`--surface`), `surface` stays the translucent glass the
 *    widgets in the desktop shot are drawn on.
 *  - `accentText`: the accent used as small text must reach 4.5:1 contrast (WCAG AA), so it is a deeper
 *    red on Paper; the plain accent stays for dots, rings and large shapes.
 *  - Paper's accent is #da3038 (the table says #e2363d, which gives white button text only 4.35:1) and
 *    Obsidian's accent ink stays charcoal (white on #e94248 is 3.9:1); see docs/DECISIONS.md.
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
  /** Art palette: ridges from far to near, the sun, wild flowers (petal and eye), the sky at the horizon, stone. */
  readonly artFar: string;
  readonly artMid: string;
  readonly artNear: string;
  readonly artSun: string;
  readonly artFlower: string;
  readonly artEye: string;
  readonly artSky: string;
  readonly artStone: string;
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
    bg: "#0e0e0e",
    surface: "rgba(22, 22, 22, 0.86)",
    surface2: "#171717",
    border: "rgba(255, 255, 255, 0.09)",
    text: "#f2f0ec",
    textDim: "#a3a19d",
    accent: "#e94248",
    accentText: "#f16d70",
    accentInk: "#111111",
    dotOn: "#f2f0ec",
    dotOff: "rgba(242, 240, 236, 0.14)",
    danger: "#f16d70",
    success: "#9eae96",
    shadow: "0 12px 32px rgba(0, 0, 0, 0.35)",
    artFar: "#2f3f35",
    artMid: "#476650",
    artNear: "#6f9a76",
    artSun: "#e94248",
    artFlower: "#e94248",
    artEye: "#f2d98a",
    artSky: "#17201b",
    artStone: "#d8d4cb",
  },
};

export const PAPER: Theme = {
  id: "paper",
  name: "Paper",
  mode: "light",
  blurb: "Warm off-white, black ink, one red.",
  colors: {
    bg: "#f6f5f2",
    surface: "rgba(255, 255, 255, 0.9)",
    surface2: "#ffffff",
    border: "rgba(0, 0, 0, 0.08)",
    text: "#0b0b0b",
    textDim: "#5f5d59",
    accent: "#da3038",
    accentText: "#b02026",
    accentInk: "#ffffff",
    dotOn: "#da3038",
    dotOff: "rgba(11, 11, 11, 0.12)",
    danger: "#c42b31",
    success: "#5f7a55",
    shadow: "0 10px 28px rgba(11, 11, 11, 0.12)",
    artFar: "#b3c0ae",
    artMid: "#86a37e",
    artNear: "#4d7a47",
    artSun: "#da3038",
    artFlower: "#da3038",
    artEye: "#f0c24a",
    artSky: "#ece8d8",
    artStone: "#2b2b27",
  },
};

export const AURUM: Theme = {
  id: "aurum",
  name: "Aurum",
  mode: "dark",
  blurb: "Near-black with a single gold.",
  colors: {
    bg: "#0d0c0a",
    surface: "rgba(22, 20, 17, 0.86)",
    surface2: "#161411",
    border: "rgba(255, 240, 210, 0.10)",
    text: "#f4efe4",
    textDim: "#a8a293",
    accent: "#e3b456",
    accentText: "#e3b456",
    accentInk: "#111111",
    dotOn: "#e3b456",
    dotOff: "rgba(227, 180, 86, 0.16)",
    danger: "#f16d70",
    success: "#9eae96",
    shadow: "0 12px 32px rgba(0, 0, 0, 0.4)",
    artFar: "#3d3422",
    artMid: "#6e5828",
    artNear: "#b08a38",
    artSun: "#e3b456",
    artFlower: "#f4efe4",
    artEye: "#e3b456",
    artSky: "#1c1810",
    artStone: "#e8dcc0",
  },
};

export const THEMES: readonly Theme[] = [PAPER, OBSIDIAN, AURUM];
/** localStorage key holding the visitor's chosen theme id. */
export const THEME_STORAGE_KEY = "dotdock-theme";
export const DEFAULT_THEME: ThemeId = "paper";

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
  artFar: "--art-far",
  artMid: "--art-mid",
  artNear: "--art-near",
  artSun: "--art-sun",
  artFlower: "--art-flower",
  artEye: "--art-eye",
  artSky: "--art-sky",
  artStone: "--art-stone",
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
