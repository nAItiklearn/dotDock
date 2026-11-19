const MILLION = 1_000_000;
const THOUSAND = 1_000;
/** Below this the full number fits the footer; above it the compact form keeps the width stable. */
const COMPACT_FROM = 10_000;
/** Compact values below this keep one decimal ("99.9k"); above it the decimal would add a sixth character. */
const ONE_DECIMAL_BELOW = 99.95;

/** Output tokens for the footer: "842", "1,284", "12.4k", "1.3M". Uses the user's locale for digits and separators. */
export function formatTokens(count: number, locale?: string): string {
  const n = Math.max(0, Math.round(count));
  if (n < COMPACT_FROM) return n.toLocaleString(locale);
  const decimals = (value: number, digits: number): string =>
    value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const thousands = n / THOUSAND;
  if (thousands < ONE_DECIMAL_BELOW) return `${decimals(thousands, 1)}k`;
  if (thousands < MILLION / THOUSAND - 0.5) return `${decimals(thousands, 0)}k`;
  const millions = n / MILLION;
  return `${decimals(millions, millions < ONE_DECIMAL_BELOW ? 1 : 0)}M`;
}

const pad2 = (n: number): string => n.toString().padStart(2, "0");

/** Elapsed turn time: "0:07", "12:03", "1:02:09". Null while the start is unknown. */
export function formatElapsed(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms)) return null;
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}
