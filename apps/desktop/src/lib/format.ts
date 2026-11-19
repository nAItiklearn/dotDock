const GIB = 1024 ** 3;

/** "215 GB" style; uses the locale's digits. */
export function formatGiB(bytes: number): string {
  return Math.round(bytes / GIB).toLocaleString();
}

/** "2:07" for 2 h 7 min. Returns null for unknown durations. */
export function formatHoursMinutes(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${m.toString().padStart(2, "0")}`;
}

export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}
