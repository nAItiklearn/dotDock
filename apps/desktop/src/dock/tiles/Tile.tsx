import { useEffect, useState } from "react";
import { DotIcon } from "../../design-system/DotMatrix";
import { Icon } from "../../design-system/Icon";
import { useProvider } from "../../providers/store";
import { sendMediaCommand } from "../../widgets/mediaControls";
import { BatteryIcon, DockIcon } from "../DockIcons";
import type { TileId } from "../model";
import { t } from "../strings";
import { AgendaFace, AudioFace, ContactsFace, FocusFace, HydrationFace, MeetingFace, MicFace, ProgressFace, RemindersFace, StopwatchFace, SystemFace } from "./faces";
import { useAwake } from "./hooks";
import type { TileControls } from "./shell";

const MS_PER_MINUTE = 60_000;
/** Lands just after the minute turns, so the clock never shows the old minute. */
const MINUTE_LAG_MS = 40;
const LOW_BATTERY = 20;

/**
 * The current time, refreshed once a minute on the minute. Nothing runs between ticks, and nothing runs at all
 * while the core has frozen the dock or the page is hidden: the clock catches up the moment it wakes.
 */
export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  const awake = useAwake();
  useEffect(() => {
    if (!awake) return undefined;
    setNow(new Date());
    let timer = 0;
    const schedule = (): void => {
      const wait = MS_PER_MINUTE - (Date.now() % MS_PER_MINUTE) + MINUTE_LAG_MS;
      timer = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, wait);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [awake]);
  return now;
}

const hourMinute = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const weekdayDay = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric" });

/** Splits a formatted time into hours, separator and minutes, so a tall dock can stack them. */
function timeParts(date: Date): { hours: string; minutes: string; suffix: string } {
  const parts = hourMinute.formatToParts(date);
  const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return { hours: pick("hour"), minutes: pick("minute"), suffix: pick("dayPeriod") };
}

function ClockTile() {
  const now = useMinuteClock();
  const { hours, minutes, suffix } = timeParts(now);
  return (
    <div className="tile tile--clock" role="timer" aria-label={`${hourMinute.format(now)}, ${weekdayDay.format(now)}`}>
      <span className="clock__time">
        <span className="clock__digits">{hours}</span>
        <span className="clock__colon" aria-hidden="true">
          :
        </span>
        <span className="clock__digits">{minutes}</span>
        {suffix ? <span className="clock__suffix">{suffix}</span> : null}
      </span>
      <span className="clock__date caps">{weekdayDay.format(now)}</span>
    </div>
  );
}

function MediaTile() {
  const { data } = useProvider("media");
  if (!data) {
    return (
      <div className="tile tile--media tile--idle" role="group" aria-label={t("tile.media")}>
        <span className="media__art">
          <DotIcon name="note" size={20} />
        </span>
        <span className="media__text">
          <span className="media__title">{t("tile.media.idle")}</span>
        </span>
      </div>
    );
  }
  return (
    <div className="tile tile--media" role="group" aria-label={t("tile.media")}>
      <span className="media__art">
        {data.artwork ? <img src={data.artwork} alt="" draggable={false} /> : <DotIcon name="note" size={20} />}
      </span>
      <span className="media__text">
        <span className="media__title">{data.title}</span>
        <span className="media__artist caps">{data.artist}</span>
      </span>
      <button
        type="button"
        className="media__button"
        aria-label={data.playing ? t("tile.media.pause") : t("tile.media.play")}
        onClick={() => sendMediaCommand({ action: "toggle" })}
      >
        <Icon name={data.playing ? "pause" : "play"} />
      </button>
    </div>
  );
}

export function Tile({ id, controls }: { readonly id: TileId; readonly controls: TileControls }) {
  switch (id) {
    case "clock":
      return <ClockTile />;
    case "media":
      return <MediaTile />;
    case "system":
      return <SystemFace controls={controls} />;
    case "agenda":
      return <AgendaFace controls={controls} />;
    case "meeting":
      return <MeetingFace controls={controls} />;
    case "focus":
      return <FocusFace controls={controls} />;
    case "stopwatch":
      return <StopwatchFace controls={controls} />;
    case "hydration":
      return <HydrationFace controls={controls} />;
    case "reminders":
      return <RemindersFace controls={controls} />;
    case "progress":
      return <ProgressFace controls={controls} />;
    case "contacts":
      return <ContactsFace controls={controls} />;
    case "mic":
      return <MicFace />;
    case "audio":
      return <AudioFace controls={controls} />;
  }
}

/** Real network state from the browser: the only source the WebView has without a provider from the core. */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = (): void => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/** Network, battery and clock. Segments whose data does not exist (a desktop has no battery) are left out. */
export function StatusPill() {
  const now = useMinuteClock();
  const online = useOnline();
  const { data: battery } = useProvider("battery");
  const { hours, minutes, suffix } = timeParts(now);
  const onAc = battery !== null && (battery.charging || battery.pluggedIn === true);
  const low = battery !== null && !onAc && battery.percent <= LOW_BATTERY;
  return (
    <div className="status" role="group" aria-label={t("status.label")}>
      <span className="status__segment" role="img" aria-label={online ? t("status.online") : t("status.offline")} data-off={online ? undefined : "true"}>
        <DockIcon name={online ? "network" : "network-off"} />
      </span>
      {battery ? (
        <span
          className="status__segment status__battery"
          data-low={low ? "true" : undefined}
          role="img"
          aria-label={t(battery.charging ? "status.battery.charging" : "status.battery", { percent: Math.round(battery.percent) })}
        >
          <BatteryIcon percent={battery.percent} charging={battery.charging} />
          <span className="status__percent">{Math.round(battery.percent)}</span>
        </span>
      ) : null}
      <span className="status__segment status__time">
        <span>{hours}</span>
        <span className="status__colon" aria-hidden="true">
          :
        </span>
        <span>{minutes}</span>
        {suffix ? <span className="status__suffix">{suffix}</span> : null}
      </span>
    </div>
  );
}
