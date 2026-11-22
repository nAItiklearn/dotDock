import { useId, type CSSProperties, type ReactNode } from "react";

export function Group({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="isl-group">
      <h3 className="isl-group__title caps">{title}</h3>
      <div className="isl-group__rows">{children}</div>
    </section>
  );
}

export interface RowIds {
  /** Put on the control so the visible label is its accessible name. */
  readonly id: string;
  /** For controls that are not labelable elements, such as a radio group. */
  readonly labelId: string;
}

interface RowProps {
  readonly label: string;
  readonly disabled?: boolean;
  /** True when the control is a group (not a form element), so the label is referenced instead of bound. */
  readonly group?: boolean;
  readonly children: (ids: RowIds) => ReactNode;
}

export function Row({ label, disabled = false, group = false, children }: RowProps) {
  const id = useId();
  const labelId = `${id}-label`;
  return (
    <div className={`isl-row${disabled ? " isl-row--disabled" : ""}`}>
      {group ? (
        <span id={labelId} className="isl-row__label">
          {label}
        </span>
      ) : (
        <label id={labelId} className="isl-row__label" htmlFor={id}>
          {label}
        </label>
      )}
      <div className="isl-row__control">{children({ id, labelId })}</div>
    </div>
  );
}

export interface SwitchProps {
  readonly id: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void;
}

export function Switch({ id, checked, disabled = false, onChange }: SwitchProps) {
  return (
    <button id={id} type="button" role="switch" aria-checked={checked} disabled={disabled} className="isl-switch" onClick={() => onChange(!checked)}>
      <span className="isl-switch__knob" />
    </button>
  );
}

export interface SegmentedProps<T extends string> {
  readonly labelId: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
}

export function Segmented<T extends string>({ labelId, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="isl-segmented" role="radiogroup" aria-labelledby={labelId}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className="isl-segmented__option"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Range inputs return floats like 0.8500000000000001; snap back to the step grid. */
function snap(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toFixed(4));
}

export interface SliderProps {
  readonly id: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly disabled?: boolean;
  /** Text shown next to the slider, already formatted. */
  readonly display: string;
  readonly onChange: (value: number) => void;
}

export function Slider({ id, value, min, max, step, disabled = false, display, onChange }: SliderProps) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="isl-slider">
      <span className="isl-slider__track" style={{ "--fill": `${fill}%` } as CSSProperties}>
        <span className="isl-slider__fill" />
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(snap(e.currentTarget.valueAsNumber, step))}
        />
      </span>
      <output className="isl-slider__value tabular" htmlFor={id}>
        {display}
      </output>
    </div>
  );
}
