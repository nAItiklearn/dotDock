import { DotMatrix } from "../design-system/DotMatrix";
import { Caps, DotGrid, Ring, Surface } from "../design-system/primitives";
import { formatGiB, percent } from "../lib/format";
import { useProvider } from "../providers/store";
import { WidgetNotice } from "./WidgetNotice";
import "./SystemWidgets.css";

const RING_SIZE = 164;
const RING_STROKE = 9;
const RAM_GRID = { cols: 6, rows: 4, dot: 14, gap: 7 } as const;
const PCT_HEIGHT = 26;

/** S card: RAM use as a dot grid, the way the light reference shows it. */
export function RamWidget() {
  const { data, issue } = useProvider("system");
  return (
    <Surface shape="card" w={2} h={2} label="Memory">
      {data ? (
        <div className="ram">
          <div className="ram__head">
            <span className="ram__pct tabular">{percent(data.memUsedBytes, data.memTotalBytes)}%</span>
            <Caps>RAM</Caps>
          </div>
          <DotGrid
            cols={RAM_GRID.cols}
            rows={RAM_GRID.rows}
            dot={RAM_GRID.dot}
            gap={RAM_GRID.gap}
            value={data.memUsedBytes / data.memTotalBytes}
          />
        </div>
      ) : (
        <WidgetNotice title="RAM" issue={issue} />
      )}
    </Surface>
  );
}

/** S circle: system drive usage as a ring. */
export function DiskWidget() {
  const { data, issue } = useProvider("system");
  const disk = data?.disks[0];
  return (
    <Surface shape="circle" w={2} h={2} label="Disk">
      {disk ? (
        <Ring value={disk.usedBytes / disk.totalBytes} size={RING_SIZE} stroke={RING_STROKE}>
          <Caps>{disk.mount}</Caps>
          <DotMatrix
            text={`${percent(disk.usedBytes, disk.totalBytes)}%`}
            matrixStyle="blocks"
            height={PCT_HEIGHT}
            label={`${percent(disk.usedBytes, disk.totalBytes)} percent used`}
          />
          <span className="disk__size tabular">
            {formatGiB(disk.usedBytes)}/{formatGiB(disk.totalBytes)} GB
          </span>
        </Ring>
      ) : (
        <WidgetNotice title="Disk" issue={issue} />
      )}
    </Surface>
  );
}
