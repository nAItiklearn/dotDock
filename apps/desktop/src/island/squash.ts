/** One CSS drop shadow broken into numbers, so it can be rescaled while the plate scales. */
export interface ShadowSpec {
  readonly x: number;
  readonly y: number;
  readonly blur: number;
  readonly spread: number;
  readonly color: string;
}

const LENGTH = String.raw`(-?\d*\.?\d+)(?:px)?`;
const SHADOW = new RegExp(String.raw`^\s*${LENGTH}\s+${LENGTH}\s+${LENGTH}(?:\s+${LENGTH})?\s+(.+?)\s*$`);

/** True when the value lists more than one shadow (a comma outside any parentheses). */
function hasTopLevelComma(value: string): boolean {
  let depth = 0;
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) return true;
  }
  return false;
}

/** Parses the theme's `--shadow` token ("0 12px 32px rgba(0, 0, 0, 0.35)"). Null when it is not a single shadow. */
export function parseShadow(value: string): ShadowSpec | null {
  if (value.includes("inset") || hasTopLevelComma(value)) return null;
  const m = SHADOW.exec(value);
  if (!m) return null;
  const [, x, y, blur, spread, color] = m;
  if (x === undefined || y === undefined || blur === undefined || color === undefined) return null;
  return { x: Number(x), y: Number(y), blur: Number(blur), spread: Number(spread ?? 0), color };
}

const px = (n: number): string => `${Math.round(n * 100) / 100}px`;

/**
 * The plate is drawn at its final size and squashed with scaleX/scaleY while it grows. Dividing the
 * border radius, hairline and shadow by that squash keeps them looking unscaled during the transition.
 */
export function squashedChrome(
  sx: number,
  sy: number,
  radius: number,
  hairline: number,
  shadow: ShadowSpec | null,
): { readonly borderRadius: string; readonly boxShadow: string } {
  const safeX = Math.max(sx, 0.001);
  const safeY = Math.max(sy, 0.001);
  const mean = Math.sqrt(safeX * safeY);
  const ring = `0 0 0 ${px(hairline / mean)} var(--border)`;
  const drop = shadow
    ? `, ${px(shadow.x / safeX)} ${px(shadow.y / safeY)} ${px(shadow.blur / mean)} ${px(shadow.spread / mean)} ${shadow.color}`
    : "";
  return { borderRadius: `${px(radius / safeX)} / ${px(radius / safeY)}`, boxShadow: ring + drop };
}

/** 0 while the plate is mostly squashed, 1 once it has nearly reached its size. Used to fade in the dot texture. */
export function settledAmount(sx: number, sy: number): number {
  const closeness = Math.min(sx, sy);
  return Math.min(1, Math.max(0, (closeness - 0.85) / 0.15));
}

/** Corner radius for a plate: fully round for the pill modes, the token radius for the card. */
export function plateRadius(round: boolean, height: number, tokenRadius: number, scale: number): number {
  return round ? height / 2 : tokenRadius * scale;
}
