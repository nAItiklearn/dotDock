import { DotMatrix } from "../design-system/DotMatrix";
import { Caps, Surface } from "../design-system/primitives";
import { useMinute } from "../providers/clock";
import "./DateCircleWidget.css";

const DIGIT_HEIGHT = 44;

/** Circular date: month on top, pixel day numeral, weekday in accent. */
export function DateCircleWidget() {
  const d = useMinute();
  const day = d.getDate().toString().padStart(2, "0");
  const month = d.toLocaleDateString(undefined, { month: "short" });
  const weekday = d.toLocaleDateString(undefined, { weekday: "long" });
  return (
    <Surface shape="circle" w={2} h={2} label={d.toLocaleDateString(undefined, { dateStyle: "full" })}>
      <div className="date-circle">
        <Caps>{month}</Caps>
        <DotMatrix className="date-circle__day" text={day} matrixStyle="blocks" height={DIGIT_HEIGHT} label={day} />
        <Caps accent>{weekday}</Caps>
      </div>
    </Surface>
  );
}
