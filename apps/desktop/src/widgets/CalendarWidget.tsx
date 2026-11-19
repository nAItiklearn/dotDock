import { useMemo } from "react";
import { Surface } from "../design-system/primitives";
import { useMinute } from "../providers/clock";
import "./CalendarWidget.css";

const DAYS_PER_WEEK = 7;

/** First day of the week for the user's locale: 0 = Sunday … 6 = Saturday. */
function localeWeekStart(): number {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    // Intl uses 1 = Monday … 7 = Sunday.
    if (info) return info.firstDay % DAYS_PER_WEEK;
  } catch {
    // Unknown locale tag: fall through to Monday.
  }
  return 1;
}

interface MonthModel {
  readonly title: string;
  /** null = padding cell before the 1st. */
  readonly cells: readonly (number | null)[];
}

function buildMonth(year: number, month: number): MonthModel {
  const weekStart = localeWeekStart();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() - weekStart + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  return { title: first.toLocaleDateString(undefined, { month: "long" }), cells };
}

/** M card: month grid with today circled in accent. */
export function CalendarWidget() {
  const now = useMinute();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const model = useMemo(() => buildMonth(year, month), [year, month]);
  return (
    <Surface shape="card" w={3} h={2} label={now.toLocaleDateString(undefined, { month: "long", year: "numeric" })}>
      <div className="calendar">
        <div className="calendar__head">
          <span className="calendar__today tabular">{today}</span>
          <span className="calendar__month">{model.title}</span>
        </div>
        <div className="calendar__grid" role="grid">
          {model.cells.map((day, i) =>
            day === null ? (
              <span key={`p${i}`} aria-hidden="true" />
            ) : (
              <span
                key={day}
                role="gridcell"
                aria-current={day === today ? "date" : undefined}
                className={`calendar__day tabular${day === today ? " calendar__day--today" : ""}`}
              >
                {day}
              </span>
            ),
          )}
        </div>
      </div>
    </Surface>
  );
}
