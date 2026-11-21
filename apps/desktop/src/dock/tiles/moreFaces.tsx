import { useMemo } from "react";
import { Icon } from "../../design-system/Icon";
import { cityById, type City } from "../../widgets/data/cities";
import { useProvider } from "../../providers/store";
import { useDockStore } from "../store";
import { plural, t } from "../strings";
import { convertMoney, formatMoney, resolvePair } from "./currency";
import { useFeed } from "./feeds";
import { useMinuteClock, useTicker } from "./hooks";
import { readFeed } from "./hub";
import { clockText } from "./memo";
import { liveBars, useMemos } from "./memoRecorder";
import { Mark, TileShell, Words, issueText, type TileControls } from "./shell";
import { arcFraction, arcPoint, deviceTimeZone, homeCity, nextEvent, sunDay } from "./sun";
import { useTools } from "./toolsStore";
import { parseAmount } from "./units";
import { beaufort, blowsToward, compassPoint } from "./wind";
import "./more.css";

interface FaceProps {
  readonly controls: TileControls;
}

const SECOND_MS = 1000;
const MINUTE_MS = 60_000;

const hourMinute = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

const zoneFormats = new Map<string, Intl.DateTimeFormat>();

/** Hours and minutes as a clock in `timeZone` shows them: a sunrise is told in the place's own time. */
export function timeIn(timeZone: string): Intl.DateTimeFormat {
  let format = zoneFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", timeZone });
    zoneFormats.set(timeZone, format);
  }
  return format;
}

// Flip clock -------------------------------------------------------------------------------------------------------

/** Two digits on a split card. The key is the value, so a new minute mounts a new card and its flip runs once. */
function FlipCard({ value }: { readonly value: string }) {
  return (
    <span className="flip__card">
      <span className="flip__digits">{value}</span>
    </span>
  );
}

export function FlipFace() {
  const now = useMinuteClock();
  const parts = hourMinute.formatToParts(now);
  const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return (
    <TileShell id="flip" label={`${t("tile.flip")}, ${hourMinute.format(now)}`}>
      <span className="flip" aria-hidden="true">
        <FlipCard value={pick("hour")} key={`h${pick("hour")}`} />
        <FlipCard value={pick("minute")} key={`m${pick("minute")}`} />
      </span>
    </TileShell>
  );
}

// Sun arc ----------------------------------------------------------------------------------------------------------

/** The city the sun follows: the one chosen in the popover, else the bundled city in the device's time zone. */
export function useSunCity(): City | null {
  const chosen = useTools((s) => s.sunCity);
  return useMemo(() => (chosen ? (cityById(chosen) ?? null) : homeCity(deviceTimeZone())), [chosen]);
}

const ARC = { cx: 50, cy: 44, r: 38 } as const;

/** The half circle of the day, the part already travelled drawn solid, and the sun on it while it is up. */
export function SunArc({ fraction }: { readonly fraction: number }) {
  const up = fraction >= 0 && fraction <= 1;
  const sun = arcPoint(fraction);
  const x = ARC.cx + sun.x * ARC.r;
  const y = ARC.cy - sun.y * ARC.r;
  const startX = ARC.cx - ARC.r;
  const endX = ARC.cx + ARC.r;
  return (
    <svg className="sun-arc" viewBox="0 0 100 52" aria-hidden="true">
      <path d={`M${startX} ${ARC.cy} A${ARC.r} ${ARC.r} 0 0 1 ${endX} ${ARC.cy}`} className="sun-arc__track" />
      {up ? <path d={`M${startX} ${ARC.cy} A${ARC.r} ${ARC.r} 0 0 1 ${x} ${y}`} className="sun-arc__done" /> : null}
      <line x1="4" y1={ARC.cy} x2="96" y2={ARC.cy} className="sun-arc__horizon" />
      {up ? <circle cx={x} cy={y} r="6" className="sun-arc__sun" /> : null}
    </svg>
  );
}

export function SunFace({ controls }: FaceProps) {
  const city = useSunCity();
  const now = useTicker(MINUTE_MS, city !== null);
  if (!city) {
    return (
      <TileShell id="sun" label={`${t("tile.sun")}, ${t("tile.sun.pick")}`} state="issue" controls={controls}>
        <Mark tone="dim">
          <Icon name="sun" />
        </Mark>
        <Words title={t("tile.sun.pick")} />
      </TileShell>
    );
  }
  const day = sunDay(now, city.lat, city.lon);
  const next = nextEvent(now, city.lat, city.lon);
  const title = next ? t(`tile.sun.${next.kind}`, { time: timeIn(city.timeZone).format(next.at) }) : t(day.kind === "night" ? "tile.sun.night" : "tile.sun.allday");
  return (
    <TileShell id="sun" label={`${t("tile.sun")}, ${city.name}, ${title}`} controls={controls}>
      <span className="sun-face">
        <SunArc fraction={arcFraction(now, day)} />
      </span>
      <Words title={title} sub={city.name} />
    </TileShell>
  );
}

// Wind -------------------------------------------------------------------------------------------------------------

const speed = new Intl.NumberFormat(undefined, { style: "unit", unit: "kilometer-per-hour", maximumFractionDigits: 0 });

export function WindFace() {
  const { data, issue } = useProvider("weather");
  const has = data !== null && data.windKmh !== undefined && data.windFromDeg !== undefined;
  if (!has) {
    const why = data === null ? (issue === null ? "" : issueText(issue)) : t("tile.issue.unsupported");
    return (
      <TileShell id="wind" label={[t("tile.wind"), why].filter((p) => p).join(", ")} state={data === null && issue === null ? "pending" : "issue"}>
        <Mark tone="dim">
          <Icon name="wind" />
        </Mark>
        <Words title={why || t("tile.wind")} />
      </TileShell>
    );
  }
  const kmh = data.windKmh ?? 0;
  const from = data.windFromDeg ?? 0;
  const point = t(`tile.wind.point.${compassPoint(from)}`);
  const gust = data.gustKmh !== undefined && data.gustKmh > kmh ? t("tile.wind.gusts", { speed: speed.format(data.gustKmh) }) : null;
  return (
    <TileShell id="wind" label={[t("tile.wind"), speed.format(kmh), t("tile.wind.from", { point }), t("tile.wind.force", { force: beaufort(kmh) }), gust].filter((p) => p).join(", ")}>
      <Mark>
        {/* Drawn pointing north, turned to the bearing the air moves toward. */}
        <svg className="wind__arrow" viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${blowsToward(from)}deg)` }}>
          <path d="M12 20.5v-15M6.5 11l5.5-5.5 5.5 5.5" />
        </svg>
      </Mark>
      <Words title={speed.format(kmh)} sub={[compassPoint(from), gust].filter((p) => p).join(" · ")} />
    </TileShell>
  );
}

// Web search -------------------------------------------------------------------------------------------------------

export function SearchFace({ controls }: FaceProps) {
  return (
    <TileShell id="search" label={t("tile.search")} controls={controls}>
      <Mark>
        <Icon name="search" />
      </Mark>
      <Words title={t("tile.search.prompt")} />
    </TileShell>
  );
}

// History ----------------------------------------------------------------------------------------------------------

const FACE_RECENT = 3;

export function HistoryFace({ controls }: FaceProps) {
  const recent = useTools((s) => s.recent);
  const apps = useDockStore((s) => s.apps);
  const shown = recent.flatMap((r) => apps.filter((a) => a.id === r.appId)).slice(0, FACE_RECENT);
  const last = shown[0];
  return (
    <TileShell id="history" label={[t("tile.history"), last ? t("tile.history.last", { name: last.name }) : t("tile.history.none")].join(", ")} controls={controls}>
      {shown.length === 0 ? (
        <Mark tone="dim">
          <Icon name="history" />
        </Mark>
      ) : (
        <span className="history-face" aria-hidden="true">
          {shown.map((app) => (app.icon ? <img key={app.id} src={app.icon} alt="" draggable={false} /> : <i key={app.id}>{app.name.charAt(0)}</i>))}
        </span>
      )}
      <Words title={last ? last.name : t("tile.history.none")} sub={last ? t("tile.history.recently") : null} />
    </TileShell>
  );
}

// Voice memo -------------------------------------------------------------------------------------------------------

/** Vertical bars, 0 to 1 tall, centred on a line: the voice memo's waveform. */
export function Waveform({ levels, className }: { readonly levels: readonly number[]; readonly className?: string }) {
  return (
    <span className={`wave-bars${className ? ` ${className}` : ""}`} aria-hidden="true">
      {levels.map((level, i) => (
        <i key={i} style={{ transform: `scaleY(${Math.max(0.08, level)})` }} />
      ))}
    </span>
  );
}

export function MemoFace({ controls }: FaceProps) {
  const status = useMemos((s) => s.status);
  const levels = useMemos((s) => s.levels);
  const startedAt = useMemos((s) => s.startedAt);
  const count = useMemos((s) => s.memos.length);
  const issue = useMemos((s) => s.issue);
  const recording = status === "recording";
  const now = useTicker(SECOND_MS, recording);
  const title = recording && startedAt !== null ? clockText(now - startedAt) : issue === "unsupported" ? issueText(issue) : t("tile.memo");
  const sub = recording ? t("tile.memo.recording") : count > 0 ? plural("tile.memo.count", count) : null;
  return (
    <TileShell id="memo" label={[t("tile.memo"), title, sub].filter((p) => p).join(", ")} state={issue === "unsupported" ? "issue" : "ready"} controls={controls}>
      <Mark tone={recording ? "danger" : undefined}>{recording ? <Waveform levels={liveBars(levels)} className="wave-bars--face" /> : <Icon name="mic" />}</Mark>
      <Words title={title} sub={sub} urgent={recording} />
    </TileShell>
  );
}

// Currency ---------------------------------------------------------------------------------------------------------

export function CurrencyFace({ controls }: FaceProps) {
  const read = readFeed(useFeed("rates"));
  const setup = useTools((s) => s.currency);
  const amount = parseAmount(setup.amount);
  const rates = read.state === "ready" ? read.data : null;
  const pair = rates ? resolvePair(rates, setup) : setup;
  const result = rates && amount !== null ? convertMoney(rates, pair.from, pair.to, amount) : null;
  const title = rates && amount !== null && result !== null ? `${formatMoney(amount, pair.from)} = ${formatMoney(result, pair.to)}` : read.state === "issue" ? issueText(read.issue) : t("tile.currency");
  return (
    <TileShell id="currency" label={[t("tile.currency"), title].join(", ")} state={read.state} controls={controls}>
      <Mark>
        <Icon name="coin" />
      </Mark>
      <Words title={title} sub={rates ? `${pair.from} → ${pair.to}` : null} />
    </TileShell>
  );
}
