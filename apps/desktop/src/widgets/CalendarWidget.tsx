import { Fragment, useMemo, useState } from "react";
import { DotMatrix } from "../design-system/DotMatrix";
import { Caps, IconButton, Surface } from "../design-system/primitives";
import { useMinute } from "../providers/clock";
import {
  buildMonth,
  DAYS_PER_WEEK,
  isoWeek,
  resolveWeekStart,
  shiftMonth,
  weekdayLabels,
  weekdayOrder,
  type MonthModel,
  type WeekStart,
  type WeekStartSetting,
} from "./calendarModel";
import type { ConfigSchema } from "./configSchema";
import { defineWidget, type WidgetProps } from "./definition";
import { sizeSpec, type SizeId, type SizeSpec } from "./sizes";
import "./CalendarWidget.css";

export interface CalendarConfig {
  readonly weekStart: WeekStartSetting;
  readonly showWeekNumbers: boolean;
}

export const CALENDAR_SIZES: readonly SizeSpec[] = [
  { id: "m", name: "Month", w: 3, h: 2 },
  { id: "s", name: "Week", w: 2, h: 2 },
  { id: "l", name: "Browser", w: 4, h: 4 },
];

const CALENDAR_SCHEMA: ConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    weekStart: {
      type: "string",
      title: "Week starts on",
      default: "auto",
      oneOf: [
        { const: "auto", title: "Follow system" },
        { const: "mon", title: "Monday" },
        { const: "sun", title: "Sunday" },
        { const: "sat", title: "Saturday" },
      ],
    },
    showWeekNumbers: { type: "boolean", title: "Week numbers", default: false, appliesToSizes: ["l"] },
  },
};

const FIXED_WEEKS = 6;
const WEEK_DIGITS = 36;

/** S circle: the current week as seven dots under a big day numeral. */
function WeekCircle({ now, weekStart }: { readonly now: Date; readonly weekStart: WeekStart }) {
  const day = now.getDate().toString();
  const order = weekdayOrder(weekStart);
  const todayIndex = order.indexOf(now.getDay());
  const spec = sizeSpec(CALENDAR_SIZES, "s");
  return (
    <Surface
      shape="circle"
      w={spec.w}
      h={spec.h}
      label={now.toLocaleDateString(undefined, { dateStyle: "full" })}
      className="week-circle"
    >
      <div className="week-circle__body">
        <Caps>{now.toLocaleDateString(undefined, { month: "short" })}</Caps>
        <DotMatrix text={day} matrixStyle="blocks" height={WEEK_DIGITS} label={day} />
        <div className="week-circle__strip" aria-hidden="true">
          {order.map((d, i) => (
            <span key={d} className={`week-circle__day${i === todayIndex ? " week-circle__day--today" : ""}`} />
          ))}
        </div>
        <Caps>{`Week ${isoWeek(now)}`}</Caps>
      </div>
    </Surface>
  );
}

function DayGrid({
  model,
  today,
  labels,
  numbers,
}: {
  readonly model: MonthModel;
  readonly today: number | null;
  /** Weekday header; omitted in the compact card, where the head already names today. */
  readonly labels: readonly string[] | null;
  readonly numbers: boolean;
}) {
  return (
    <div className={`calendar__grid${numbers ? " calendar__grid--numbered" : ""}`} role="grid">
      {labels ? (
        <>
          {numbers ? <span aria-hidden="true" /> : null}
          {labels.map((label, i) => (
            <span key={i} className="calendar__weekday" role="columnheader">
              {label}
            </span>
          ))}
        </>
      ) : null}
      {Array.from({ length: model.weekCount }, (_, w) => (
        <Fragment key={w}>
          {numbers ? <span className="calendar__week tabular">{model.weekNumbers[w]}</span> : null}
          {model.cells.slice(w * DAYS_PER_WEEK, (w + 1) * DAYS_PER_WEEK).map((day, i) => (
            <span key={i} className="calendar__slot" role={day === null ? "presentation" : "gridcell"}>
              {day === null ? null : (
                <span
                  aria-current={day === today ? "date" : undefined}
                  className={`calendar__day tabular${day === today ? " calendar__day--today" : ""}`}
                >
                  {day}
                </span>
              )}
            </span>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

/** M card: this month with today circled. */
function MonthCard({ now, weekStart }: { readonly now: Date; readonly weekStart: WeekStart }) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const model = useMemo(() => buildMonth(year, month, weekStart), [year, month, weekStart]);
  const spec = sizeSpec(CALENDAR_SIZES, "m");
  return (
    <Surface shape="card" w={spec.w} h={spec.h} label={now.toLocaleDateString(undefined, { month: "long", year: "numeric" })}>
      <div className="calendar">
        <div className="calendar__head">
          <span className="calendar__today tabular">{now.getDate()}</span>
          <span className="calendar__month">{now.toLocaleDateString(undefined, { month: "long" })}</span>
          <Caps>{now.toLocaleDateString(undefined, { weekday: "short" })}</Caps>
        </div>
        <DayGrid model={model} today={now.getDate()} labels={null} numbers={false} />
      </div>
    </Surface>
  );
}

/** L card: a full month you can page through, with optional week numbers. */
function MonthBrowser({
  now,
  weekStart,
  showWeekNumbers,
}: {
  readonly now: Date;
  readonly weekStart: WeekStart;
  readonly showWeekNumbers: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const view = shiftMonth(now.getFullYear(), now.getMonth(), offset);
  const model = useMemo(() => buildMonth(view.year, view.month, weekStart, FIXED_WEEKS), [view.year, view.month, weekStart]);
  const labels = useMemo(() => weekdayLabels(weekStart), [weekStart]);
  const first = new Date(view.year, view.month, 1);
  const isCurrent = offset === 0;
  const spec = sizeSpec(CALENDAR_SIZES, "l");
  return (
    <Surface shape="card" w={spec.w} h={spec.h} label={first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}>
      <div className="calendar calendar--browser">
        <div className="calendar__head calendar__head--browser">
          <div className="calendar__title">
            <span className="calendar__month">{first.toLocaleDateString(undefined, { month: "long" })}</span>
            <Caps accent={isCurrent}>{view.year}</Caps>
          </div>
          <div className="calendar__nav">
            <IconButton icon="chevron-left" label="Previous month" size="sm" tone="ghost" onClick={() => setOffset((o) => o - 1)} />
            <button
              type="button"
              className="calendar__jump"
              disabled={isCurrent}
              onClick={() => setOffset(0)}
              aria-label="Back to this month"
            >
              <Caps>Today</Caps>
            </button>
            <IconButton icon="chevron-right" label="Next month" size="sm" tone="ghost" onClick={() => setOffset((o) => o + 1)} />
          </div>
        </div>
        <DayGrid
          model={model}
          today={isCurrent ? now.getDate() : null}
          labels={labels}
          numbers={showWeekNumbers}
        />
      </div>
    </Surface>
  );
}

export function CalendarWidget({
  size = "m",
  config = { weekStart: "auto", showWeekNumbers: false },
}: {
  readonly size?: SizeId;
  readonly config?: CalendarConfig;
}) {
  const now = useMinute();
  const weekStart = resolveWeekStart(config.weekStart, navigator.language);
  if (size === "s") return <WeekCircle now={now} weekStart={weekStart} />;
  if (size === "l") return <MonthBrowser now={now} weekStart={weekStart} showWeekNumbers={config.showWeekNumbers} />;
  return <MonthCard now={now} weekStart={weekStart} />;
}

export const calendarWidget = defineWidget<CalendarConfig>({
  id: "calendar",
  name: "Calendar",
  description: "Today at a glance, this month, or a month browser with week numbers. Follows your locale.",
  category: "time",
  sizes: CALENDAR_SIZES,
  providers: [],
  defaultConfig: { weekStart: "auto", showWeekNumbers: false },
  settingsSchema: CALENDAR_SCHEMA,
  component: ({ config, size }: WidgetProps<CalendarConfig>) => <CalendarWidget config={config} size={size} />,
});
