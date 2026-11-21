import { useEffect, useLayoutEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { Icon, type IconName } from "../../design-system/Icon";
import { useProvider } from "../../providers/store";
import { formatDuration, MS_PER_MINUTE } from "../../widgets/format";
import { useTimerStore } from "../../widgets/timerStore";
import { useTodoStore } from "../../widgets/todoStore";
import { EmptyGlyph } from "../EmptyGlyph";
import { placeBesideDock, TILE_POPOVER, TILE_POPOVER_SIZE, type PopoverTileId } from "../geometry";
import { markOpenPainted } from "../openMarks";
import { useDockStore, type OpenTile } from "../store";
import { plural, t } from "../strings";
import { useViewport } from "../useViewport";
import { nextAgendaChange, summariseAgenda } from "./agenda";
import { runTileCommand, tilesBackend } from "./backend";
import { ACTION_ORDER, sortedChannels } from "./contacts";
import { useFeed } from "./feeds";
import { readFeed } from "./hub";
import { FOCUS_PLAN, focusView } from "./focus";
import { formatVolume, lapRows, meetingCountdown, nextCountdownChange, stopwatchElapsed, stopwatchText } from "./format";
import { startFocus } from "./faces";
import { GLASS_LARGE, GlassDots } from "./Glass";
import { DotGraph, PeriodDots } from "./Graphs";
import { useBoundary, useTicker } from "./hooks";
import { graphLevels } from "./history";
import { nextMidnight, periodGrids } from "./period";
import { remindersView } from "./reminders";
import { issueText } from "./shell";
import { useSystemHistory } from "./systemHistory";
import { ColourBody, ConvertBody, EmojiBody, NetworkBody, NotesBody, TogglesBody, WorldBody } from "./toolsPopovers";
import type { ContactAction, TileIssue } from "./ui-types";
import { CurrencyBody, HistoryBody, MemoBody, SearchBody, SunBody } from "./morePopovers";
import { hydrationFill } from "./wave";
import "../panels.css";
import "./popovers.css";

const PERCENT = 100;
/** Columns and rows of the system graphs. */
const GRAPH_COLS = 30;
const GRAPH_ROWS = 10;
/** How long a hydration reminder is put off. */
const SNOOZE_MINUTES = 30;
/** How often the stopwatch's tenths and the system graph redraw while their popover is open. */
const TENTH_MS = 100;
const SECOND_MS = 1000;
/** Share of a bar the volume slider moves per key press. */
const VOLUME_STEP = 0.05;
const NO_EVENTS: readonly never[] = [];

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });

// Shared pieces --------------------------------------------------------------------------------------------------

function Empty({ title, hint }: { readonly title: string; readonly hint?: string }) {
  return (
    <div className="tp-empty">
      <EmptyGlyph size={44} />
      <p>{title}</p>
      {hint ? <p className="tp-hint">{hint}</p> : null}
    </div>
  );
}

/** What a popover shows instead of its content when its feed has none, one state for each reason. */
function Issue({ issue }: { readonly issue: TileIssue }) {
  return <Empty title={issueText(issue)} hint={t(`tile.issue.${issue}.hint`)} />;
}

function Button({
  children,
  icon,
  onClick,
  primary,
  disabled,
  label,
}: {
  readonly children?: ReactNode;
  readonly icon?: IconName;
  readonly onClick: () => void;
  readonly primary?: boolean;
  readonly disabled?: boolean;
  readonly label?: string;
}) {
  return (
    <button type="button" className="tp-btn" data-primary={primary ? "true" : undefined} disabled={disabled} aria-label={label} onClick={onClick}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

const command = (promise: Promise<void>): void => void runTileCommand(promise);

// System ----------------------------------------------------------------------------------------------------------

function SystemBody() {
  const { data, issue } = useProvider("system");
  const samples = useSystemHistory((s) => s.samples);
  const now = useTicker(SECOND_MS, true);
  if (!data) return <Issue issue={issue ?? "unsupported"} />;
  const last = samples[samples.length - 1];
  const rows: readonly { readonly metric: "cpu" | "mem"; readonly label: string; readonly value: number }[] = [
    { metric: "cpu", label: t("tile.system.cpu"), value: Math.round(last?.cpu ?? data.cpuPercent) },
    { metric: "mem", label: t("tile.system.memory"), value: Math.round(last?.mem ?? (data.memTotalBytes > 0 ? (data.memUsedBytes / data.memTotalBytes) * PERCENT : 0)) },
  ];
  return (
    <div className="tp-body">
      {rows.map((row) => (
        <section key={row.metric} className="tp-metric" aria-label={`${row.label} ${row.value}%`}>
          <header className="tp-row">
            <span className="caps">{row.label}</span>
            <b className="tp-value">{t("tile.audio.percent", { percent: row.value })}</b>
          </header>
          <DotGraph levels={graphLevels(samples, row.metric, now, GRAPH_COLS, GRAPH_ROWS)} rows={GRAPH_ROWS} />
        </section>
      ))}
      <p className="tp-hint tp-center">{t("tile.system.window")}</p>
    </div>
  );
}

// Calendar day ----------------------------------------------------------------------------------------------------

function EventRow({ title, when, place, tone }: { readonly title: string; readonly when: string; readonly place: string | null; readonly tone?: "live" | "past" | undefined }) {
  return (
    <li className="tp-event" data-tone={tone}>
      <span className="tp-event__when">{when}</span>
      <span className="tp-event__text">
        <b>{title}</b>
        {place ? <span className="tp-hint">{place}</span> : null}
      </span>
    </li>
  );
}

function AgendaBody() {
  const read = readFeed(useFeed("agenda"));
  const events = read.state === "ready" ? read.data.events : NO_EVENTS;
  const now = useBoundary((at) => nextAgendaChange(events, at));
  if (read.state === "issue") return <Issue issue={read.issue} />;
  if (read.state === "pending") return null;
  const summary = summariseAgenda(read.data.events, now, Number.POSITIVE_INFINITY);
  if (read.data.events.length === 0) return <Empty title={t("tile.agenda.none")} hint={t("tile.agenda.none.hint")} />;
  const range = (start: number, end: number): string => `${timeFormat.format(start)} – ${timeFormat.format(end)}`;
  return (
    <div className="tp-body tp-scroll">
      <p className="tp-hint">{dayFormat.format(read.data.day)}</p>
      {summary.allDay.length > 0 ? (
        <ul className="tp-list">
          {summary.allDay.map((e) => (
            <EventRow key={e.id} title={e.title} when={t("tile.agenda.allDay")} place={e.location} />
          ))}
        </ul>
      ) : null}
      {summary.past.length > 0 ? (
        <>
          <h3 className="tp-heading caps">{t("tile.agenda.earlier")}</h3>
          <ul className="tp-list">
            {summary.past.map((e) => (
              <EventRow key={e.id} title={e.title} when={range(e.startsAt, e.endsAt)} place={e.location} tone="past" />
            ))}
          </ul>
        </>
      ) : null}
      {summary.upcoming.length > 0 ? (
        <>
          <h3 className="tp-heading caps">{t("tile.agenda.later")}</h3>
          <ul className="tp-list">
            {summary.upcoming.map((e) => (
              <EventRow key={e.id} title={e.title} when={e.startsAt <= now ? t("tile.agenda.live") : range(e.startsAt, e.endsAt)} place={e.location} tone={e.startsAt <= now ? "live" : undefined} />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

// Next meeting ----------------------------------------------------------------------------------------------------

function MeetingBody() {
  const read = readFeed(useFeed("meeting"));
  const meeting = read.state === "ready" ? read.data : null;
  const now = useBoundary((at) => (meeting ? nextCountdownChange(meeting, at) : null));
  if (read.state === "issue") return <Issue issue={read.issue} />;
  if (read.state === "pending") return null;
  if (meeting === null) return <Empty title={t("tile.meeting.none")} hint={t("tile.meeting.none.hint")} />;
  const countdown = meetingCountdown(meeting, now);
  const url = meeting.joinUrl;
  return (
    <div className="tp-body tp-center">
      <b className="tp-big" data-urgent={countdown.urgent ? "true" : undefined}>
        {countdown.text}
      </b>
      <h3 className="tp-title">{meeting.title}</h3>
      <p className="tp-hint">{t("tile.meeting.when", { start: timeFormat.format(meeting.startsAt), end: timeFormat.format(meeting.endsAt) })}</p>
      {meeting.location ? <p className="tp-hint">{meeting.location}</p> : null}
      {url !== null && countdown.phase !== "over" ? (
        <Button icon="video" primary onClick={() => command(tilesBackend().commands.joinMeeting(url))}>
          {meeting.service ? t("tile.meeting.joinWith", { service: meeting.service }) : t("tile.meeting.join")}
        </Button>
      ) : null}
    </div>
  );
}

// Focus timer -----------------------------------------------------------------------------------------------------

function FocusBody() {
  const timer = useTimerStore((s) => s.timer);
  const running = timer.mode === "pomodoro" && timer.status === "running";
  const now = useTicker(SECOND_MS, running);
  const view = focusView(timer, FOCUS_PLAN, now);
  const { pause, reset, skipPhase } = useTimerStore.getState();
  const done = view.phase === "focus" ? view.session - 1 : view.session;
  return (
    <div className="tp-body tp-center">
      <span className="tp-phase caps">{t(`tile.focus.phase.${view.phase}`)}</span>
      <b className="tp-big">{formatDuration(view.remainingMs)}</b>
      <span className="tp-sessions" role="img" aria-label={t("tile.focus.session", { number: view.session, total: view.sessions })}>
        {Array.from({ length: view.sessions }, (_, i) => (
          <i key={i} data-done={i < done ? "true" : undefined} data-now={view.phase === "focus" && i === view.session - 1 ? "true" : undefined} />
        ))}
      </span>
      <p className="tp-hint">{view.phase === "focus" ? t("tile.focus.break", { minutes: Math.round(view.breakMs / MS_PER_MINUTE) }) : t("tile.focus.session", { number: view.session, total: view.sessions })}</p>
      <div className="tp-actions">
        <Button icon={running ? "pause" : "play"} primary disabled={view.busy} onClick={() => (running ? pause() : startFocus())}>
          {running ? t("tile.focus.pause") : view.status === "paused" ? t("tile.focus.resume") : t("tile.focus.start")}
        </Button>
        <Button icon="next" disabled={view.busy} onClick={() => skipPhase(FOCUS_PLAN)}>
          {t("tile.focus.skip")}
        </Button>
        <Button icon="reset" disabled={view.busy || view.status === "idle"} onClick={reset}>
          {t("tile.focus.reset")}
        </Button>
      </div>
      {view.busy ? <p className="tp-hint" role="status">{t("tile.focus.busy")}</p> : null}
    </div>
  );
}

// Stopwatch -------------------------------------------------------------------------------------------------------

function StopwatchBody() {
  const read = readFeed(useFeed("stopwatch"));
  const view = read.state === "ready" ? read.data : null;
  const now = useTicker(TENTH_MS, view?.running === true);
  if (read.state === "issue") return <Issue issue={read.issue} />;
  if (view === null) return null;
  const text = stopwatchText(stopwatchElapsed(view, now));
  const laps = lapRows(view.laps);
  const op = (name: "start" | "pause" | "lap" | "reset") => () => command(tilesBackend().commands.stopwatch(name));
  return (
    <div className="tp-body">
      <div className="tp-center">
        <b className="tp-big">
          {text.clock}
          <small>.{text.tenth}</small>
        </b>
        <div className="tp-actions">
          <Button icon={view.running ? "pause" : "play"} primary onClick={op(view.running ? "pause" : "start")}>
            {view.running ? t("tile.stopwatch.pause") : t("tile.stopwatch.start")}
          </Button>
          <Button icon="flag" disabled={!view.running} onClick={op("lap")}>
            {t("tile.stopwatch.lap")}
          </Button>
          <Button icon="reset" disabled={view.running || (view.bankedMs === 0 && view.laps.length === 0)} onClick={op("reset")}>
            {t("tile.stopwatch.reset")}
          </Button>
        </div>
      </div>
      {laps.length === 0 ? (
        <p className="tp-hint tp-center">{t("tile.stopwatch.laps.none")}</p>
      ) : (
        <ol className="tp-laps tp-scroll" aria-label={t("tile.stopwatch.lap")}>
          {laps.map((lap) => (
            <li key={lap.number} data-mark={lap.mark ?? undefined}>
              <span>{t("tile.stopwatch.lap.number", { number: lap.number })}</span>
              <b>{formatDuration(lap.splitMs)}</b>
              <span className="caps">{lap.mark === "fastest" ? t("tile.stopwatch.fastest") : lap.mark === "slowest" ? t("tile.stopwatch.slowest") : ""}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// Water -----------------------------------------------------------------------------------------------------------

function HydrationBody() {
  const read = readFeed(useFeed("hydration"));
  if (read.state === "issue") return <Issue issue={read.issue} />;
  if (read.state === "pending") return null;
  const view = read.data;
  const reached = hydrationFill(view.loggedMl, view.goalMl) >= 1;
  const next = view.nextReminderAt;
  return (
    <div className="tp-body tp-center">
      <div className="tp-glass">
        <GlassDots loggedMl={view.loggedMl} goalMl={view.goalMl} size={GLASS_LARGE} />
      </div>
      <b className="tp-value">{t("tile.hydration.of", { logged: formatVolume(view.loggedMl), goal: formatVolume(view.goalMl) })}</b>
      <p className="tp-hint" role="status">
        {reached ? t("tile.hydration.reached") : next === null ? t("tile.hydration.off") : t("tile.hydration.next", { time: timeFormat.format(next) })}
      </p>
      <div className="tp-actions">
        <Button icon="plus" primary onClick={() => command(tilesBackend().commands.hydration({ type: "log", ml: view.glassMl }))}>
          {t("tile.hydration.glass", { amount: formatVolume(view.glassMl) })}
        </Button>
        <Button disabled={next === null} onClick={() => command(tilesBackend().commands.hydration({ type: "snooze", minutes: SNOOZE_MINUTES }))}>
          {t("tile.hydration.snooze", { minutes: SNOOZE_MINUTES })}
        </Button>
      </div>
    </div>
  );
}

// Reminders -------------------------------------------------------------------------------------------------------

function RemindersBody() {
  const items = useTodoStore((s) => s.items);
  const { add, toggle, remove } = useTodoStore.getState();
  const now = useBoundary(nextMidnight);
  const view = useMemo(() => remindersView(items, new Date(now)), [items, now]);
  const [draft, setDraft] = useState("");
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (draft.trim() === "") return;
    add(draft);
    setDraft("");
  };
  return (
    <div className="tp-body">
      <form className="tp-add" onSubmit={submit}>
        <input className="tp-input" value={draft} placeholder={t("tile.reminders.placeholder")} aria-label={t("tile.reminders.add")} maxLength={140} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="tp-btn" data-primary="true" aria-label={t("tile.reminders.add")} disabled={draft.trim() === ""}>
          <Icon name="plus" />
        </button>
      </form>
      {view.rows.length === 0 ? (
        <Empty title={t("tile.reminders.none")} hint={t("tile.reminders.none.hint")} />
      ) : (
        <ul className="tp-list tp-scroll">
          {view.rows.map((row) => (
            <li key={row.id} className="tp-todo" data-done={row.done ? "true" : undefined}>
              <button type="button" className="tp-check" role="checkbox" aria-checked={row.done} aria-label={t(row.done ? "tile.reminders.reopen" : "tile.reminders.complete", { text: row.text })} onClick={() => toggle(row.id)}>
                {row.done ? <Icon name="check" /> : null}
              </button>
              <span className="tp-todo__text">
                {row.text}
                {row.state === "overdue" || row.state === "today" ? (
                  <small className="caps" data-state={row.state}>
                    {t(row.state === "overdue" ? "tile.reminders.due.overdue" : "tile.reminders.due.today")}
                  </small>
                ) : null}
              </span>
              <button type="button" className="tp-icon" aria-label={t("tile.reminders.delete", { text: row.text })} onClick={() => remove(row.id)}>
                <Icon name="trash" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="tp-hint tp-center">{plural("tile.reminders.open", view.open)}</p>
    </div>
  );
}

// Progress --------------------------------------------------------------------------------------------------------

function ProgressBody() {
  const now = useBoundary((at) => at - (at % MS_PER_MINUTE) + MS_PER_MINUTE);
  const grids = periodGrids(new Date(now));
  return (
    <div className="tp-body">
      {(["day", "month", "year"] as const).map((id) => (
        <section key={id} className="tp-metric" aria-label={`${t(`tile.progress.${id}`)} ${t("tile.progress.percent", { percent: grids[id].percent })}`}>
          <header className="tp-row">
            <span className="caps">{t(`tile.progress.${id}`)}</span>
            <b className="tp-value">{t("tile.progress.percent", { percent: grids[id].percent })}</b>
          </header>
          <PeriodDots grid={grids[id]} />
        </section>
      ))}
    </div>
  );
}

// Contacts --------------------------------------------------------------------------------------------------------

const ACTION_ICON: Record<ContactAction, IconName> = { call: "phone", video: "video", message: "message" };

function ContactsBody() {
  const read = readFeed(useFeed("contacts"));
  if (read.state === "issue") return <Issue issue={read.issue} />;
  if (read.state === "pending") return null;
  if (read.data.contacts.length === 0) return <Empty title={t("tile.contacts.empty")} hint={t("tile.contacts.empty.hint")} />;
  return (
    <ul className="tp-list tp-scroll tp-body">
      {read.data.contacts.map((contact) => (
        <li key={contact.id} className="tp-contact">
          <span className="avatar">{contact.name.trim().charAt(0).toLocaleUpperCase()}</span>
          <b className="tp-contact__name">{contact.name}</b>
          <span className="tp-contact__actions">
            {sortedChannels(contact).map((channel) => (
              <button
                key={channel.action}
                type="button"
                className="tp-icon"
                data-order={ACTION_ORDER.indexOf(channel.action)}
                aria-label={t("tile.contacts.act", { action: t(`tile.contacts.${channel.action}`), name: contact.name, app: channel.app })}
                title={`${t(`tile.contacts.${channel.action}`)} · ${channel.app}`}
                onClick={() => command(tilesBackend().commands.contact(contact.id, channel.action))}
              >
                <Icon name={ACTION_ICON[channel.action]} />
              </button>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Sound -----------------------------------------------------------------------------------------------------------

function AudioBody() {
  const read = readFeed(useFeed("audio"));
  const [local, setLocal] = useState<number | null>(null);
  if (read.state === "issue") return <Issue issue={read.issue} />;
  if (read.state === "pending") return null;
  const view = read.data;
  const volume = local ?? view.volume;
  const send = (value: number): void => {
    setLocal(value);
    command(tilesBackend().commands.audio({ type: "volume", value }));
  };
  return (
    <div className="tp-body">
      <section className="tp-metric">
        <header className="tp-row">
          <span className="caps">{t("tile.audio.volume")}</span>
          <b className="tp-value">{t("tile.audio.percent", { percent: Math.round(volume * PERCENT) })}</b>
        </header>
        <div className="tp-slider">
          <Button
            icon={view.muted ? "volume-off" : "volume"}
            label={view.muted ? t("tile.audio.unmute") : t("tile.audio.mute")}
            onClick={() => command(tilesBackend().commands.audio({ type: "mute", muted: !view.muted }))}
          />
          <input
            type="range"
            min={0}
            max={1}
            step={VOLUME_STEP / 5}
            value={volume}
            aria-label={t("tile.audio.volume")}
            onChange={(e) => send(Number(e.target.value))}
            onPointerUp={() => setLocal(null)}
            onBlur={() => setLocal(null)}
          />
        </div>
      </section>
      <h3 className="tp-heading caps">{t("tile.audio.output")}</h3>
      {view.devices.length === 0 ? (
        <Empty title={t("tile.audio.none")} />
      ) : (
        <ul className="tp-list tp-scroll" role="radiogroup" aria-label={t("tile.audio.output")}>
          {view.devices.map((device) => (
            <li key={device.id}>
              <button
                type="button"
                className="tp-device"
                role="radio"
                aria-checked={device.current}
                onClick={() => command(tilesBackend().commands.audio({ type: "output", deviceId: device.id }))}
              >
                <i aria-hidden="true" />
                {device.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The popover -----------------------------------------------------------------------------------------------------

const BODY: Record<PopoverTileId, () => ReactNode> = {
  system: () => <SystemBody />,
  agenda: () => <AgendaBody />,
  meeting: () => <MeetingBody />,
  focus: () => <FocusBody />,
  stopwatch: () => <StopwatchBody />,
  hydration: () => <HydrationBody />,
  reminders: () => <RemindersBody />,
  progress: () => <ProgressBody />,
  contacts: () => <ContactsBody />,
  audio: () => <AudioBody />,
  notes: () => <NotesBody />,
  colour: () => <ColourBody />,
  convert: () => <ConvertBody />,
  emoji: () => <EmojiBody />,
  world: () => <WorldBody />,
  network: () => <NetworkBody />,
  toggles: () => <TogglesBody />,
  sun: () => <SunBody />,
  currency: () => <CurrencyBody />,
  search: () => <SearchBody />,
  history: () => <HistoryBody />,
  memo: () => <MemoBody />,
};

/** The popover of one live tile: its full controls, opened beside the tile. Esc, a click away or the close button shuts it. */
export function TilePopover({ open }: { readonly open: OpenTile }) {
  const viewport = useViewport();
  const size = TILE_POPOVER_SIZE[open.id];
  const pos = placeBesideDock(open.from, { w: size.w, h: size.h }, viewport, TILE_POPOVER.gap);
  const label = t(`tile.${open.id}`);

  useLayoutEffect(() => {
    markOpenPainted("tile");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || useDockStore.getState().menu !== null) return;
      e.preventDefault();
      useDockStore.getState().showTile(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const style = {
    transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
    width: size.w,
    height: size.h,
    "--tone": "var(--accent)",
    "--pop-pad": `${TILE_POPOVER.pad}px`,
    "--pop-head": `${TILE_POPOVER.head}px`,
  } as CSSProperties;

  return (
    <div className="popover tilepop" role="dialog" aria-label={label} style={style} data-open="true" data-tile={open.id}>
      <div className="popover__plate" />
      <div className="popover__content">
        <header className="popover__head">
          <i className="popover__dot" />
          <h2 className="popover__title">{label}</h2>
          <button type="button" className="tp-icon tilepop__close" aria-label={t("tile.close")} onClick={() => useDockStore.getState().showTile(null)}>
            <Icon name="cross" />
          </button>
        </header>
        {BODY[open.id]()}
      </div>
    </div>
  );
}
