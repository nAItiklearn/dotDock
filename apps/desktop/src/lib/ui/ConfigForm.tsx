import type { JsonObject, JsonValue } from "../model/json";
import type { ConfigField } from "../model/types";
import { Segmented, SelectField, Slider, Switch } from "./controls";

export interface ConfigFormProps {
  readonly fields: readonly ConfigField[];
  readonly config: JsonObject;
  readonly onChange: (key: string, value: JsonValue) => void;
  readonly disabled?: boolean;
}

/** A settings form generated from a widget's declared fields: every widget is customisable with no extra UI. */
export function ConfigForm({ fields, config, onChange, disabled = false }: ConfigFormProps) {
  return (
    <div className="ui-form">
      {fields.map((field) => {
        const current = config[field.key];
        return (
          <div className="ui-form__row" key={field.key}>
            <span className="ui-form__label">{field.label}</span>
            {field.type === "toggle" ? (
              <Switch checked={current === true} label={field.label} disabled={disabled} onChange={(next) => onChange(field.key, next)} />
            ) : null}
            {field.type === "choice" ? (
              field.options.length <= 3 ? (
                <Segmented
                  value={typeof current === "string" ? current : (field.options[0]?.value ?? "")}
                  options={field.options}
                  label={field.label}
                  disabled={disabled}
                  onChange={(next) => onChange(field.key, next)}
                />
              ) : (
                <SelectField
                  value={typeof current === "string" ? current : (field.options[0]?.value ?? "")}
                  options={field.options}
                  label={field.label}
                  disabled={disabled}
                  onChange={(next) => onChange(field.key, next)}
                />
              )
            ) : null}
            {field.type === "range" ? (
              <span className="ui-form__range">
                <Slider
                  value={typeof current === "number" ? current : field.min}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  label={field.label}
                  disabled={disabled}
                  onChange={(next) => onChange(field.key, next)}
                />
                <span className="ui-form__value tabular">
                  {typeof current === "number" ? current : field.min}
                  {field.unit ?? ""}
                </span>
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
