/**
 * Widget settings described as data, so a settings UI can render any widget's form
 * without widget-specific code. A strict subset of JSON Schema (draft 2020-12):
 * booleans, titled enums (`oneOf` of `const`/`title`), bounded numbers and
 * bounded lists of strings. `appliesToSizes` is the one extension: it hides a
 * field for sizes where it changes nothing.
 */
import type { SizeId } from "./sizes";

interface FieldBase {
  readonly title: string;
  readonly description?: string;
  /** Sizes this field affects. Omitted means every size. */
  readonly appliesToSizes?: readonly SizeId[];
}

export interface TitledOption {
  readonly const: string;
  readonly title: string;
}

export interface BooleanField extends FieldBase {
  readonly type: "boolean";
  readonly default: boolean;
}

export interface EnumField extends FieldBase {
  readonly type: "string";
  readonly default: string;
  readonly oneOf: readonly TitledOption[];
}

export interface TextField extends FieldBase {
  readonly type: "string";
  readonly default: string;
  readonly maxLength: number;
}

export interface NumberField extends FieldBase {
  readonly type: "number";
  readonly default: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly multipleOf: number;
  /** Shown after the value, e.g. "min" or "%". */
  readonly unit?: string;
}

export interface StringListField extends FieldBase {
  readonly type: "array";
  readonly default: readonly string[];
  readonly maxItems: number;
  readonly uniqueItems: boolean;
  readonly items: { readonly type: "string"; readonly maxLength: number } | { readonly type: "string"; readonly oneOf: readonly TitledOption[] };
}

export type ConfigField = BooleanField | EnumField | TextField | NumberField | StringListField;

export interface ConfigSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, ConfigField>>;
  readonly additionalProperties: false;
}

export type ConfigValue = boolean | string | number | readonly string[];
export type RawConfig = Readonly<Record<string, unknown>>;

export function isEnumField(field: ConfigField): field is EnumField {
  return field.type === "string" && "oneOf" in field;
}

function isListOfEnum(field: StringListField): field is StringListField & { items: { oneOf: readonly TitledOption[] } } {
  return "oneOf" in field.items;
}

/** Decimal places of a step such as 0.1 or 5, so rounding does not leave 0.30000000000000004. */
function decimals(step: number): number {
  const text = step.toString();
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

function snap(value: number, field: NumberField): number {
  const clamped = Math.min(field.maximum, Math.max(field.minimum, value));
  const steps = Math.round((clamped - field.minimum) / field.multipleOf);
  const snapped = Number((field.minimum + steps * field.multipleOf).toFixed(decimals(field.multipleOf)));
  return Math.min(field.maximum, snapped);
}

function normalizeField(field: ConfigField, raw: unknown): ConfigValue {
  switch (field.type) {
    case "boolean":
      return typeof raw === "boolean" ? raw : field.default;
    case "number":
      return typeof raw === "number" && Number.isFinite(raw) ? snap(raw, field) : field.default;
    case "array": {
      if (!Array.isArray(raw)) return field.default;
      const allowed = isListOfEnum(field) ? new Set(field.items.oneOf.map((o) => o.const)) : null;
      const maxLength = "maxLength" in field.items ? field.items.maxLength : Number.POSITIVE_INFINITY;
      const out: string[] = [];
      for (const item of raw as unknown[]) {
        if (typeof item !== "string") continue;
        const text = allowed ? item : item.trim().slice(0, maxLength);
        if (text === "" || (allowed && !allowed.has(text))) continue;
        if (field.uniqueItems && out.includes(text)) continue;
        out.push(text);
        if (out.length === field.maxItems) break;
      }
      return out;
    }
    case "string": {
      if (typeof raw !== "string") return field.default;
      if (isEnumField(field)) return field.oneOf.some((o) => o.const === raw) ? raw : field.default;
      return raw.slice(0, field.maxLength);
    }
  }
}

/** Default value of every field. */
export function schemaDefaults(schema: ConfigSchema): Record<string, ConfigValue> {
  return Object.fromEntries(Object.entries(schema.properties).map(([key, field]) => [key, field.default]));
}

/**
 * Turns whatever was stored (older versions, hand-edited files) into a valid config:
 * unknown keys are dropped, bad values fall back to the default, numbers are clamped and snapped.
 */
export function normalizeConfig(schema: ConfigSchema, raw: unknown): Record<string, ConfigValue> {
  const source: RawConfig = typeof raw === "object" && raw !== null ? (raw as RawConfig) : {};
  return Object.fromEntries(
    Object.entries(schema.properties).map(([key, field]) => [key, normalizeField(field, source[key])]),
  );
}

/** Fields a settings form should show for one size. */
export function fieldsForSize(schema: ConfigSchema, size: SizeId): readonly (readonly [string, ConfigField])[] {
  return Object.entries(schema.properties).filter(([, field]) => !field.appliesToSizes || field.appliesToSizes.includes(size));
}
