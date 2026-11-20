import { sizesByArea, type SizeSpec } from "../../widgets/sizes";
import { Segmented, SelectField } from "./controls";

/** More sizes than this no longer fit in one row of a panel, so they are offered as a list. */
const SEGMENTED_LIMIT = 4;

export interface SizePickerProps {
  readonly sizes: readonly SizeSpec[];
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly label: string;
}

/** Chooses a widget footprint: a segmented strip for a few sizes, a list (with the cell counts) for many. */
export function SizePicker({ sizes, value, onChange, label }: SizePickerProps) {
  const ordered = sizesByArea(sizes);
  if (ordered.length <= SEGMENTED_LIMIT) {
    return <Segmented label={label} value={value} options={ordered.map((s) => ({ value: s.id, label: s.name }))} onChange={onChange} />;
  }
  return (
    <SelectField
      label={label}
      value={value}
      options={ordered.map((s) => ({ value: s.id, label: `${s.name} · ${s.w}×${s.h}` }))}
      onChange={onChange}
    />
  );
}
