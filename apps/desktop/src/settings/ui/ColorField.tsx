import { useEffect, useState } from "react";
import { fieldName, Slider, TextField } from "../../lib/ui/controls";
import { formatColor, parseColor, toCss, type Rgba } from "../../lib/theme/color";

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };
const PERCENT = 100;

export interface ColorFieldProps {
  readonly label: string;
  /** Canonical #rrggbb or #rrggbbaa. */
  readonly value: string;
  readonly onChange: (next: string) => void;
  /** Roles that are translucent on the desktop (cards, borders, unlit dots) get an opacity slider. */
  readonly alpha?: boolean;
}

/** Colour well, hex entry and optional opacity, all instant-apply. */
export function ColorField({ label, value, onChange, alpha = false }: ColorFieldProps) {
  const parsed = parseColor(value) ?? BLACK;
  const canonical = formatColor(parsed);
  const [text, setText] = useState(canonical);

  // Follow outside changes (Generate palette, undo) without clobbering a half-typed hex:
  // only a change of the committed colour re-syncs the field.
  useEffect(() => {
    setText((current) => {
      const typed = parseColor(current);
      return typed && formatColor(typed) === canonical ? current : canonical;
    });
  }, [canonical]);

  return (
    <div className="color-field">
      <span className="color-field__label">{label}</span>
      <label className="color-field__well" style={{ background: toCss(parsed) }}>
        <input
          type="color"
          name={fieldName(`${label} colour`)}
          value={formatColor({ ...parsed, a: 1 })}
          aria-label={`${label} colour picker`}
          onChange={(e) => {
            const picked = parseColor(e.currentTarget.value);
            if (picked) onChange(formatColor({ ...picked, a: parsed.a }));
          }}
        />
      </label>
      <TextField
        label={`${label} hex value`}
        value={text}
        maxLength={9}
        invalid={parseColor(text) === null}
        onChange={(next) => {
          setText(next);
          const typed = parseColor(next);
          if (typed) onChange(formatColor(typed));
        }}
      />
      {alpha ? (
        <span className="color-field__alpha">
          <Slider
            label={`${label} opacity`}
            min={0}
            max={PERCENT}
            step={1}
            value={Math.round(parsed.a * PERCENT)}
            valueText={`${Math.round(parsed.a * PERCENT)} percent`}
            onChange={(percent) => onChange(formatColor({ ...parsed, a: percent / PERCENT }))}
          />
          <span className="control-value tabular">{Math.round(parsed.a * PERCENT)}%</span>
        </span>
      ) : null}
    </div>
  );
}
