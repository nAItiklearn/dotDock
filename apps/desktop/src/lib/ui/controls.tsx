import { useId, useRef, type ButtonHTMLAttributes, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import "./controls.css";

/** Form controls carry a name (browsers and autofill expect one); it is just the accessible label, slugged. */
export function fieldName(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ----------------------------------------------------------------- buttons

export type ButtonVariant = "default" | "primary" | "danger" | "ghost";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  readonly variant?: ButtonVariant;
  readonly icon?: IconName;
  readonly children?: ReactNode;
}

export function Button({ variant = "default", icon, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button {...rest} type={type} className={`ui-button ui-button--${variant}`}>
      {icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children" | "aria-label"> {
  readonly icon: IconName;
  /** Required: an icon alone says nothing to a screen reader. Also shown as the tooltip. */
  readonly label: string;
  readonly active?: boolean;
  readonly tone?: "default" | "danger";
}

export function IconButton({ icon, label, active = false, tone = "default", type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      title={label}
      aria-label={label}
      className={`ui-icon-button${active ? " is-active" : ""}${tone === "danger" ? " ui-icon-button--danger" : ""}`}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

// ------------------------------------------------------------------ switch

interface SwitchProps {
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
  readonly label: string;
  readonly disabled?: boolean;
}

/** On/off toggle: a pill track with a round knob, matching the dot language of the desktop. */
export function Switch({ checked, onChange, label, disabled = false }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="ui-switch"
      onClick={() => onChange(!checked)}
    >
      <span className="ui-switch__knob" />
    </button>
  );
}

// ------------------------------------------------------------------ slider

interface SliderProps {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly onChange: (next: number) => void;
  readonly label: string;
  readonly disabled?: boolean;
  /** Spoken value for screen readers, e.g. "12 pixels". */
  readonly valueText?: string;
}

export function Slider({ value, min, max, step, onChange, label, disabled = false, valueText }: SliderProps) {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      name={fieldName(label)}
      className="ui-slider"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-label={label}
      aria-valuetext={valueText}
      style={{ "--fill": `${fill}%` } as CSSProperties}
      onChange={(e) => onChange(Number(e.currentTarget.value))}
    />
  );
}

// --------------------------------------------------------------- segmented

export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: IconName;
}

interface SegmentedProps<T extends string> {
  readonly value: T;
  readonly options: readonly SegmentOption<T>[];
  readonly onChange: (next: T) => void;
  readonly label: string;
  readonly disabled?: boolean;
}

/** Radio group drawn as a pill strip. Arrow keys move and select, Home/End jump, as native radios do. */
export function Segmented<T extends string>({ value, options, onChange, label, disabled = false }: SegmentedProps<T>) {
  const group = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const index = options.findIndex((o) => o.value === value);
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % options.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + options.length) % options.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    const target = options[next];
    if (!target) return;
    e.preventDefault();
    onChange(target.value);
    group.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };
  return (
    <div ref={group} className="ui-segmented" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            className={`ui-segmented__option${selected ? " is-selected" : ""}`}
            onClick={() => onChange(option.value)}
          >
            {option.icon ? <Icon name={option.icon} size={15} /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------ select / text

interface SelectFieldProps<T extends string> {
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (next: T) => void;
  readonly label: string;
  readonly disabled?: boolean;
}

/** Native select: the platform handles keyboard, typeahead and screen readers better than we could. */
export function SelectField<T extends string>({ value, options, onChange, label, disabled = false }: SelectFieldProps<T>) {
  return (
    <span className="ui-select">
      <select name={fieldName(label)} value={value} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.currentTarget.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevron" size={14} />
    </span>
  );
}

interface TextFieldProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly label: string;
  readonly placeholder?: string;
  readonly maxLength?: number;
  readonly type?: "text" | "time";
  readonly disabled?: boolean;
  readonly onCommit?: () => void;
  readonly invalid?: boolean;
}

export function TextField({ value, onChange, label, placeholder, maxLength, type = "text", disabled = false, onCommit, invalid = false }: TextFieldProps) {
  const id = useId();
  return (
    <input
      id={id}
      name={fieldName(label)}
      className="ui-text"
      type={type}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      disabled={disabled}
      aria-label={label}
      aria-invalid={invalid || undefined}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => onChange(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit?.();
      }}
      onBlur={onCommit}
    />
  );
}

// ------------------------------------------------------------------- misc

/** Keyboard-key look for shortcut display. */
export function Kbd({ children }: { readonly children: ReactNode }) {
  return <kbd className="ui-kbd">{children}</kbd>;
}

/** A shortcut string like "Ctrl+Alt+E" shown as separate keys. */
export function Shortcut({ value }: { readonly value: string }) {
  return (
    <span className="ui-shortcut" aria-label={value.replaceAll("+", " plus ")}>
      {value.split("+").map((key, i) => (
        <Kbd key={`${key}${i}`}>{key}</Kbd>
      ))}
    </span>
  );
}
