const MILLION = 1_000_000;
const THOUSAND = 1_000;
/** Below this the full number fits the footer; above it the compact form keeps the width stable. */
const COMPACT_FROM = 10_000;
/** Compact values below this keep one decimal ("99.9k"); above it the decimal would add a sixth character. */
const ONE_DECIMAL_BELOW = 99.95;

/**
 * One number formatter per locale and decimal count, made once. Building a formatter loads the locale's data,
 * which cost about 20 ms on the island's first expansion and then again on every animated frame of a count of
 * ten thousand or more; a cached one formats in microseconds.
 */
const formatters = new Map<string, Intl.NumberFormat>();

function formatter(locale: string | undefined, digits: number | null): Intl.NumberFormat {
  const key = `${locale ?? ""}|${digits ?? ""}`;
  let f = formatters.get(key);
  if (f === undefined) {
    f = new Intl.NumberFormat(locale, digits === null ? undefined : { minimumFractionDigits: digits, maximumFractionDigits: digits });
    formatters.set(key, f);
  }
  return f;
}

/** Output tokens for the footer: "842", "1,284", "12.4k", "1.3M". Uses the user's locale for digits and separators. */
export function formatTokens(count: number, locale?: string): string {
  const n = Math.max(0, Math.round(count));
  if (n < COMPACT_FROM) return formatter(locale, null).format(n);
  const decimals = (value: number, digits: number): string => formatter(locale, digits).format(value);
  const thousands = n / THOUSAND;
  if (thousands < ONE_DECIMAL_BELOW) return `${decimals(thousands, 1)}k`;
  if (thousands < MILLION / THOUSAND - 0.5) return `${decimals(thousands, 0)}k`;
  const millions = n / MILLION;
  return `${decimals(millions, millions < ONE_DECIMAL_BELOW ? 1 : 0)}M`;
}

/** Builds the user's formatters ahead of time, at start, so the first count on screen costs nothing. */
export function warmTokenFormats(): void {
  for (const n of [0, 10_000, 100_000]) formatTokens(n);
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

/** The token counter nudges its arrow only when real output grows; a reset to a new turn or a repeat stays still. */
export function tokensTick(previous: number, next: number): boolean {
  return next > previous && next > 0;
}
