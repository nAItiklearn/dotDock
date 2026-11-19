import { DotMatrix } from "../design-system/DotMatrix";
import { Caps, DotGrid, Ring, Surface } from "../design-system/primitives";
import { formatHoursMinutes } from "../lib/format";
import { useProvider } from "../providers/store";
import { WidgetNotice } from "./WidgetNotice";
import "./BatteryWidgets.css";

const RING_SIZE = 164;
const RING_STROKE = 9;
const PERCENT_HEIGHT = 30;
const GRID = { cols: 12, rows: 3, dot: 18, gap: 6 } as const;

function statusText(charging: boolean, remaining: string | null): string {
  if (charging) return remaining ? `Full in ${remaining}` : "Charging";
  return remaining ? `${remaining} left` : "On battery";
}

/** S circle: ring gauge with the percentage in the middle. */
export function BatteryRingWidget() {
  const { data, issue } = useProvider("battery");
  return (
    <Surface shape="circle" w={2} h={2} label="Battery">
      {data ? (
        <Ring value={data.percent / 100} size={RING_SIZE} stroke={RING_STROKE}>
          <span className={`battery__bolt${data.charging ? " battery__bolt--on" : ""}`} aria-hidden="true" />
          <DotMatrix text={`${data.percent}%`} matrixStyle="blocks" height={PERCENT_HEIGHT} label={`${data.percent} percent`} />
          <Caps>{data.charging ? "Charging" : "Battery"}</Caps>
        </Ring>
      ) : (
        <WidgetNotice title="Battery" issue={issue} />
      )}
    </Surface>
  );
}

/** M card: percentage, state, time left and a dot-grid gauge. */
export function BatteryGridWidget() {
  const { data, issue } = useProvider("battery");
  if (!data) {
    return (
      <Surface shape="card" w={4} h={2} label="Battery">
        <WidgetNotice title="Battery" issue={issue} />
      </Surface>
    );
  }
  const remaining = formatHoursMinutes(data.secondsRemaining);
  return (
    <Surface shape="card" w={4} h={2} label={`Battery ${data.percent} percent`}>
      <div className="battery-grid">
        <div className="battery-grid__head">
          <span className="battery-grid__pct tabular">{data.percent}%</span>
          <span className="battery-grid__state">{statusText(data.charging, remaining)}</span>
        </div>
        <DotGrid cols={GRID.cols} rows={GRID.rows} dot={GRID.dot} gap={GRID.gap} value={data.percent / 100} />
      </div>
    </Surface>
  );
}
