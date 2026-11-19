import { fieldsForSize, isEnumField, type ConfigField, type ConfigSchema, type ConfigValue } from "../../widgets/configSchema";
import type { SizeId } from "../../widgets/sizes";
import type { JsonValue } from "../model/json";
import { fieldName, Segmented, SelectField, Slider, Switch, TextField } from "./controls";

export interface ConfigFormProps {
  readonly schema: ConfigSchema;
  /** The size being edited; fields that do not apply to it are hidden. */
  readonly size: SizeId;
  /** The widget's resolved config: every field has a valid value. */
  readonly config: Readonly<Record<string, ConfigValue>>;
  readonly onChange: (key: string, value: JsonValue) => void;
  readonly disabled?: boolean;
}

interface FieldProps {
  readonly field: ConfigField;
  readonly value: ConfigValue | undefined;
  readonly onChange: (value: JsonValue) => void;
  readonly disabled: boolean;
}

const EMPTY = "";

function FieldControl({ field, value, onChange, disabled }: FieldProps) {
  if (field.type === "boolean") {
    return <Switch checked={value === true} label={field.title} disabled={disabled} onChange={onChange} />;
  }
  if (field.type === "number") {
    const current = typeof value === "number" ? value : field.default;
    return (
      <span className="ui-form__range">
        <Slider value={current} min={field.minimum} max={field.maximum} step={field.multipleOf} label={field.title} disabled={disabled} onChange={onChange} />
        <span className="ui-form__value tabular">
          {current}
          {field.unit ? ` ${field.unit}` : ""}
        </span>
      </span>
    );
  }
  if (field.type === "string" && isEnumField(field)) {
    const current = typeof value === "string" ? value : field.default;
    const options = field.oneOf.map((o) => ({ value: o.const, label: o.title }));
    return options.length <= 3 ? (
      <Segmented value={current} options={options} label={field.title} disabled={disabled} onChange={onChange} />
    ) : (
      <SelectField value={current} options={options} label={field.title} disabled={disabled} onChange={onChange} />
    );
  }
  if (field.type === "string") {
    return <TextField value={typeof value === "string" ? value : field.default} label={field.title} maxLength={field.maxLength} disabled={disabled} onChange={onChange} />;
  }
  const list = Array.isArray(value) ? (value as readonly string[]) : field.default;
  if ("oneOf" in field.items) {
    // An ordered pick: one select per slot, each offering the options the other slots have not taken.
    const options = field.items.oneOf;
    return (
      <span className="ui-form__slots">
        {Array.from({ length: field.maxItems }, (_, index) => {
          const current = list[index] ?? EMPTY;
          const taken = new Set(list.filter((_item, i) => i !== index));
          const choices = [
            { value: EMPTY, label: "None" },
            ...options.filter((o) => !taken.has(o.const)).map((o) => ({ value: o.const, label: o.title })),
          ];
          return (
            <SelectField
              key={index}
              value={current}
              options={choices}
              label={`${field.title} ${index + 1}`}
              disabled={disabled}
              onChange={(next) => {
                const out = [...list];
                out[index] = next;
                onChange(out.filter((item) => item !== EMPTY));
              }}
            />
          );
        })}
      </span>
    );
  }
  // Free text, one entry per line.
  return (
    <textarea
      className="ui-text ui-form__lines"
      name={fieldName(field.title)}
      aria-label={field.title}
      rows={4}
      disabled={disabled}
      spellCheck={false}
      defaultValue={list.join("\n")}
      onBlur={(e) => onChange(e.currentTarget.value.split("\n").map((line) => line.trim()).filter((line) => line !== ""))}
    />
  );
}

/** A settings form generated from a widget's schema: every widget is customisable with no widget-specific UI. */
export function ConfigForm({ schema, size, config, onChange, disabled = false }: ConfigFormProps) {
  return (
    <div className="ui-form">
      {fieldsForSize(schema, size).map(([key, field]) => (
        <div className="ui-form__row" key={key}>
          <span className="ui-form__text">
            <span className="ui-form__label">{field.title}</span>
            {field.description ? <span className="ui-form__hint">{field.description}</span> : null}
          </span>
          <FieldControl field={field} value={config[key]} disabled={disabled} onChange={(next) => onChange(key, next)} />
        </div>
      ))}
    </div>
  );
}
