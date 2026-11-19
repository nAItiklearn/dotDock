/** JSON value types and the small coercion helpers every sanitizer uses. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

/** Deepest nesting accepted in widget config; keeps hostile or broken files cheap to read. */
const MAX_JSON_DEPTH = 6;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > MAX_JSON_DEPTH) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((v) => isJsonValue(v, depth + 1));
  if (isRecord(value)) return Object.values(value).every((v) => isJsonValue(v, depth + 1));
  return false;
}

/** Keys that must never be copied from an untrusted object into a plain one (prototype pollution). */
export function isSafeKey(key: string): boolean {
  return key !== "__proto__" && key !== "constructor" && key !== "prototype";
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Integer in [lo, hi]; anything else becomes the fallback. */
export function intInRange(value: unknown, lo: number, hi: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp(Math.round(value), lo, hi) : fallback;
}

export function numberInRange(value: unknown, lo: number, hi: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, lo, hi) : fallback;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Trimmed, length-limited text; empty or non-string input becomes the fallback. */
export function textOr(value: unknown, maxLength: number, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed.length > 0 ? trimmed : fallback;
}

/** Collects what a sanitizer had to fix, so the UI can tell the user instead of failing silently. */
export class Repairs {
  readonly notes: string[] = [];
  note(path: string, why: string): void {
    this.notes.push(`${path}: ${why}`);
  }
  get any(): boolean {
    return this.notes.length > 0;
  }
}

/** Picks only JSON-safe entries of an object, dropping functions, NaN, cycles and the like. */
export function toJsonObject(value: unknown): JsonObject {
  if (!isRecord(value)) return {};
  const out: Record<string, JsonValue> = {};
  for (const [key, v] of Object.entries(value)) {
    if (isSafeKey(key) && isJsonValue(v)) out[key] = v;
  }
  return out;
}
