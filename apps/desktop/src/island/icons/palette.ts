import type { Tone } from "./frames";

export interface Palette {
  readonly tones: Readonly<Record<Tone, string>>;
  readonly lead: string;
  /** Unlit lattice dots. */
  readonly off: string;
}

/** Neutral dots use the text colour: --dot-on equals the accent in Paper and Aurum, which would swallow the lead dot. */
const TONE_VAR: Readonly<Record<Tone, string>> = {
  neutral: "--text",
  accent: "--accent",
  success: "--success",
  danger: "--danger",
  dim: "--text-dim",
};

/** Resolves the theme's colours once, so the canvas never reads CSS while drawing a frame. */
export function readPalette(root: HTMLElement = document.documentElement): Palette {
  const style = getComputedStyle(root);
  const read = (name: string): string => style.getPropertyValue(name).trim();
  const tones = Object.fromEntries(Object.entries(TONE_VAR).map(([tone, name]) => [tone, read(name)])) as Record<Tone, string>;
  return { tones, lead: read("--accent"), off: read("--dot-off") };
}

/** Calls `listener` whenever applyTheme() rewrites the theme properties. Returns the unsubscribe function. */
export function watchTheme(listener: () => void, root: HTMLElement = document.documentElement): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(root, { attributes: true, attributeFilter: ["style", "data-theme"] });
  return () => observer.disconnect();
}
