/** Theme token sets. Every colour on screen comes from one of these roles. */
export interface ThemeColors {
  readonly bg: string;
  readonly surface: string;
  readonly surface2: string;
  readonly border: string;
  readonly text: string;
  readonly textDim: string;
  readonly accent: string;
  readonly accentInk: string;
  readonly dotOn: string;
  readonly dotOff: string;
  readonly danger: string;
  readonly success: string;
  readonly shadow: string;
}

export interface Theme {
  readonly id: string;
  readonly name: string;
  readonly mode: "light" | "dark";
  readonly colors: ThemeColors;
}

export const OBSIDIAN: Theme = {
  id: "obsidian",
  name: "Obsidian",
  mode: "dark",
  colors: {
    bg: "#111111",
    surface: "rgba(22, 22, 22, 0.86)",
    surface2: "#1c1c1c",
    border: "rgba(255, 255, 255, 0.07)",
    text: "#e8e6e3",
    textDim: "#8a8a86",
    accent: "#e94248",
    accentInk: "#ffffff",
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
  colors: {
    bg: "#e8e6e3",
    surface: "rgba(245, 244, 241, 0.92)",
    surface2: "#dcdad6",
    border: "rgba(17, 17, 17, 0.06)",
    text: "#111111",
    textDim: "#6b6a66",
    accent: "#e2363d",
    accentInk: "#ffffff",
    dotOn: "#e2363d",
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
  colors: {
    bg: "#0c0c0c",
    surface: "rgba(18, 17, 15, 0.86)",
    surface2: "#1c1a16",
    border: "rgba(232, 200, 120, 0.10)",
    text: "#f5f4f1",
    textDim: "#a3a19d",
    accent: "#e2b453",
    accentInk: "#111111",
    dotOn: "#e2b453",
    dotOff: "rgba(226, 180, 83, 0.16)",
    danger: "#f16d70",
    success: "#9eae96",
    shadow: "0 12px 32px rgba(0, 0, 0, 0.4)",
  },
};

export const BUILTIN_THEMES: readonly Theme[] = [OBSIDIAN, PAPER, AURUM];

const CSS_VAR: Record<keyof ThemeColors, string> = {
  bg: "--bg",
  surface: "--surface",
  surface2: "--surface-2",
  border: "--border",
  text: "--text",
  textDim: "--text-dim",
  accent: "--accent",
  accentInk: "--accent-ink",
  dotOn: "--dot-on",
  dotOff: "--dot-off",
  danger: "--danger",
  success: "--success",
  shadow: "--shadow",
};

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  for (const key of Object.keys(CSS_VAR) as (keyof ThemeColors)[]) {
    root.style.setProperty(CSS_VAR[key], theme.colors[key]);
  }
  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.mode;
}

/** Removes what `applyTheme` set on an element, so it inherits the page's theme again. */
export function clearTheme(root: HTMLElement): void {
  for (const name of Object.values(CSS_VAR)) root.style.removeProperty(name);
  delete root.dataset.theme;
  root.style.removeProperty("color-scheme");
}

export function themeById(id: string): Theme {
  return BUILTIN_THEMES.find((t) => t.id === id) ?? OBSIDIAN;
}

/** Calls `listener` whenever applyTheme() rewrites the theme properties. Returns the unsubscribe function. */
export function watchTheme(listener: () => void, root: HTMLElement = document.documentElement): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(root, { attributes: true, attributeFilter: ["style", "data-theme"] });
  return () => observer.disconnect();
}
