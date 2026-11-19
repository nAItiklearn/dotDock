import { DotMatrix } from "../design-system/DotMatrix";
import { Caps, Surface } from "../design-system/primitives";
import { useMinute } from "../providers/clock";
import type { ConfigSchema } from "./configSchema";
import { defineWidget, type WidgetProps } from "./definition";
import { sizeSpec, type SizeId, type SizeSpec } from "./sizes";
import "./DateCircleWidget.css";

export interface DateConfig {
  /** Show the month and weekday captions. */
  readonly showLabels: boolean;
}

const DATE_SIZES: readonly SizeSpec[] = [
  { id: "s", name: "Circle", w: 2, h: 2 },
  { id: "m", name: "Pill", w: 3, h: 1 },
];

const DATE_SCHEMA: ConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    showLabels: { type: "boolean", title: "Show labels", default: true },
  },
};

const CIRCLE_DIGITS = 48;
const PILL_DIGITS = 32;

const dayText = (d: Date): string => d.getDate().toString().padStart(2, "0");

/** S circle: month on top, pixel day numeral, weekday in accent. */
export function DateCircleWidget({ showLabels = true }: { readonly showLabels?: boolean }) {
  const d = useMinute();
  const spec = sizeSpec(DATE_SIZES, "s");
  const day = dayText(d);
  return (
    <Surface shape="circle" w={spec.w} h={spec.h} label={d.toLocaleDateString(undefined, { dateStyle: "full" })}>
      <div className="date-circle">
        {showLabels ? <Caps>{d.toLocaleDateString(undefined, { month: "short" })}</Caps> : null}
        <DotMatrix text={day} matrixStyle="blocks" height={CIRCLE_DIGITS} label={day} />
        {showLabels ? <Caps accent>{d.toLocaleDateString(undefined, { weekday: "long" })}</Caps> : null}
      </div>
    </Surface>
  );
}

/** M pill: day numeral beside the weekday and the full date. */
export function DatePillWidget({ showLabels = true }: { readonly showLabels?: boolean }) {
  const d = useMinute();
  const spec = sizeSpec(DATE_SIZES, "m");
  const day = dayText(d);
  return (
    <Surface shape="pill" w={spec.w} h={spec.h} label={d.toLocaleDateString(undefined, { dateStyle: "full" })}>
      <div className="date-pill">
        <DotMatrix text={day} matrixStyle="blocks" height={PILL_DIGITS} label={day} />
        <div className="date-pill__text">
          {showLabels ? <Caps accent>{d.toLocaleDateString(undefined, { weekday: "long" })}</Caps> : null}
          <span className="date-pill__date">{d.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
        </div>
      </div>
    </Surface>
  );
}

function DateWidget({ size, config }: { readonly size: SizeId; readonly config: DateConfig }) {
  return size === "m" ? <DatePillWidget showLabels={config.showLabels} /> : <DateCircleWidget showLabels={config.showLabels} />;
}

export const dateWidget = defineWidget<DateConfig>({
  id: "date",
  name: "Date",
  description: "Today's date as a pixel numeral, with the weekday in your accent colour.",
  category: "time",
  sizes: DATE_SIZES,
  providers: [],
  defaultConfig: { showLabels: true },
  settingsSchema: DATE_SCHEMA,
  component: ({ config, size }: WidgetProps<DateConfig>) => <DateWidget size={size} config={config} />,
});
