import { Caps, DotArc, DotGrid, DotMeter, Numeral, Ring, Surface } from "../design-system/primitives";
import { useProvider } from "../providers/store";
import type { SystemData } from "../providers/types";
import type { ConfigSchema } from "./configSchema";
import { defineWidget, type WidgetProps } from "./definition";
import { formatGigabytePair, wholePercent } from "./format";
import { sizeSpec, type SizeId, type SizeSpec } from "./sizes";
import { Freshness, WidgetNotice } from "./WidgetNotice";
import "./SystemWidgets.css";

export type SystemMetric = "ram" | "cpu" | "disk";

export interface SystemConfig {
  /** What the small and medium sizes show. The large size shows all three. */
  readonly metric: SystemMetric;
}

const SYSTEM_SIZES: readonly SizeSpec[] = [
  { id: "m", name: "Dot grid", w: 2, h: 2 },
  { id: "s", name: "Half circle", w: 2, h: 1 },
  { id: "l", name: "Overview", w: 4, h: 2 },
];

const SYSTEM_SCHEMA: ConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    metric: {
      type: "string",
      title: "Show",
      default: "ram",
      appliesToSizes: ["s", "m"],
      oneOf: [
        { const: "ram", title: "Memory" },
        { const: "cpu", title: "Processor" },
        { const: "disk", title: "System drive" },
      ],
    },
  },
};

const DEFAULT_CONFIG: SystemConfig = { metric: "ram" };

const LABEL: Record<SystemMetric, string> = { ram: "RAM", cpu: "CPU", disk: "Disk" };
const CARD_GRID = { cols: 6, rows: 4, dot: 14, gap: 7 } as const;
const HALF_ARC = { count: 17, radius: 30, dot: 5 } as const;
const OVERVIEW_METER = { count: 8, dot: 6, gap: 3 } as const;
const CARD_DIGITS = 32;
const RING_DIGITS = 30;
const HALF_DIGITS = 22;
const OVERVIEW_DIGITS = 28;

interface Reading {
  /** 0..1 */
  readonly value: number;
  readonly percent: number;
  /** Second line: "10.9 / 15.9 GB" for memory and drives, nothing for the CPU. */
  readonly detail: string | null;
  /** Caption, e.g. "RAM" or the drive letter. */
  readonly label: string;
}

/** Turns provider data into what a gauge needs. Null when this machine reports no such metric. */
function readMetric(data: SystemData, metric: SystemMetric): Reading | null {
  if (metric === "ram") {
    const percent = wholePercent(data.memUsedBytes, data.memTotalBytes);
    return {
      value: percent / 100,
      percent,
      detail: formatGigabytePair(data.memUsedBytes, data.memTotalBytes),
      label: LABEL.ram,
    };
  }
  if (metric === "cpu") {
    const percent = Math.min(100, Math.max(0, Math.round(data.cpuPercent)));
    return { value: percent / 100, percent, detail: null, label: LABEL.cpu };
  }
  const disk = data.disks[0];
  if (!disk) return null;
  const percent = wholePercent(disk.usedBytes, disk.totalBytes);
  return {
    value: percent / 100,
    percent,
    detail: formatGigabytePair(disk.usedBytes, disk.totalBytes),
    label: disk.mount,
  };
}

const percentLabel = (r: Reading): string => `${r.label} ${r.percent} percent`;

function Unavailable({ title, compact = false }: { readonly title: string; readonly compact?: boolean }) {
  const { issue } = useProvider("system");
  return <WidgetNotice title={title} issue={issue} message={compact && issue === "unsupported" ? "Unavailable" : undefined} compact={compact} />;
}

/** S pill: a half-circle of dots, the number and the label. */
export function SystemHalfWidget({ config = DEFAULT_CONFIG }: { readonly config?: SystemConfig }) {
  const state = useProvider("system");
  const spec = sizeSpec(SYSTEM_SIZES, "s");
  const reading = state.data ? readMetric(state.data, config.metric) : null;
  return (
    <Surface shape="pill" w={spec.w} h={spec.h} label={reading ? percentLabel(reading) : LABEL[config.metric]}>
      {reading ? (
        <div className="system-half">
          <DotArc value={reading.value} count={HALF_ARC.count} radius={HALF_ARC.radius} dot={HALF_ARC.dot} />
          <div className="system-half__text">
            <Numeral value={reading.percent.toString()} unit="%" height={HALF_DIGITS} label={percentLabel(reading)} />
            <Caps>{reading.label}</Caps>
          </div>
        </div>
      ) : (
        <Unavailable title={LABEL[config.metric]} compact />
      )}
      <Freshness state={state} />
    </Surface>
  );
}

/** M: memory and processor as a dot grid card. */
export function RamWidget({ config = DEFAULT_CONFIG }: { readonly config?: SystemConfig }) {
  const state = useProvider("system");
  const spec = sizeSpec(SYSTEM_SIZES, "m");
  const metric = config.metric === "disk" ? "ram" : config.metric;
  const reading = state.data ? readMetric(state.data, metric) : null;
  return (
    <Surface shape="card" w={spec.w} h={spec.h} label={reading ? percentLabel(reading) : LABEL[metric]}>
      {reading ? (
        <div className="system-card">
          <div className="system-card__head">
            <Numeral value={reading.percent.toString()} unit="%" height={CARD_DIGITS} label={percentLabel(reading)} />
            <Caps>{reading.label}</Caps>
          </div>
          <DotGrid cols={CARD_GRID.cols} rows={CARD_GRID.rows} dot={CARD_GRID.dot} gap={CARD_GRID.gap} value={reading.value} />
        </div>
      ) : (
        <Unavailable title={LABEL[metric]} />
      )}
      <Freshness state={state} />
    </Surface>
  );
}

/** M circle: the system drive as a ring. */
export function DiskWidget() {
  const state = useProvider("system");
  const spec = sizeSpec(SYSTEM_SIZES, "m");
  const reading = state.data ? readMetric(state.data, "disk") : null;
  return (
    <Surface shape="circle" w={spec.w} h={spec.h} label={reading ? percentLabel(reading) : LABEL.disk}>
      {reading ? (
        <Ring value={reading.value}>
          <Caps>{reading.label}</Caps>
          <Numeral value={reading.percent.toString()} unit="%" height={RING_DIGITS} label={percentLabel(reading)} />
          <span className="system-ring__detail tabular">{reading.detail}</span>
        </Ring>
      ) : (
        <Unavailable title={LABEL.disk} />
      )}
      <Freshness state={state} />
    </Surface>
  );
}

function OverviewColumn({ reading, title }: { readonly reading: Reading | null; readonly title: string }) {
  return (
    <div className="system-overview__col">
      <Caps>{reading?.label ?? title}</Caps>
      {reading ? (
        <>
          <Numeral value={reading.percent.toString()} unit="%" height={OVERVIEW_DIGITS} label={percentLabel(reading)} />
          <DotMeter value={reading.value} count={OVERVIEW_METER.count} dot={OVERVIEW_METER.dot} gap={OVERVIEW_METER.gap} />
          <span className="system-overview__detail tabular">{reading.detail ?? " "}</span>
        </>
      ) : (
        <span className="system-overview__detail">No reading</span>
      )}
    </div>
  );
}

/** L card: memory, processor and system drive side by side. */
export function SystemOverviewWidget() {
  const state = useProvider("system");
  const spec = sizeSpec(SYSTEM_SIZES, "l");
  return (
    <Surface shape="card" w={spec.w} h={spec.h} label="System overview">
      {state.data ? (
        <div className="system-overview">
          <OverviewColumn reading={readMetric(state.data, "ram")} title={LABEL.ram} />
          <OverviewColumn reading={readMetric(state.data, "cpu")} title={LABEL.cpu} />
          <OverviewColumn reading={readMetric(state.data, "disk")} title={LABEL.disk} />
        </div>
      ) : (
        <Unavailable title="System" />
      )}
      <Freshness state={state} />
    </Surface>
  );
}

function SystemWidget({ size, config }: { readonly size: SizeId; readonly config: SystemConfig }) {
  if (size === "s") return <SystemHalfWidget config={config} />;
  if (size === "l") return <SystemOverviewWidget />;
  return config.metric === "disk" ? <DiskWidget /> : <RamWidget config={config} />;
}

export const systemWidget = defineWidget<SystemConfig>({
  id: "system",
  name: "System",
  description: "Memory, processor and drive use as dot gauges, updated every second.",
  category: "system",
  sizes: SYSTEM_SIZES,
  providers: ["system"],
  defaultConfig: DEFAULT_CONFIG,
  settingsSchema: SYSTEM_SCHEMA,
  component: ({ config, size }: WidgetProps<SystemConfig>) => <SystemWidget size={size} config={config} />,
});
