import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../design-system/Icon";
import { useProvider } from "../../providers/store";
import { chimeReady, claimChime, playChime } from "../../widgets/chime";
import { formatDuration, MS_PER_MINUTE } from "../../widgets/format";
import { finishKey, remainingMs } from "../../widgets/timerModel";
import { useTimerStore } from "../../widgets/timerStore";
import { useTodoStore } from "../../widgets/todoStore";
import { plural, t } from "../strings";
import { nextAgendaChange, summariseAgenda } from "./agenda";
import { runTileCommand, tilesBackend } from "./backend";
import { avatarRow, initials } from "./contacts";
import { DotRing } from "./DotRing";
import { useFeed } from "./feeds";
import { readFeed, type FeedRead } from "./hub";
import { FOCUS_PLAN, focusView } from "./focus";
import { formatVolume, meetingCountdown, nextCountdownChange, stopwatchElapsed, stopwatchText } from "./format";
import { useAwake, useBoundary, useTicker } from "./hooks";
import { nextMidnight, periodGrids } from "./period";
import { remindersView } from "./reminders";
import { Mark, TileShell, Words, issueText, type TileControls } from "./shell";
import { useRecordSystemLoad } from "./systemHistory";
import type { AgendaEvent, AudioView, ContactsView, HydrationView, MeetingView, MicView, StopwatchView } from "./ui-types";
import { GlassDots } from "./Glass";
import "./faces.css";

const PERCENT = 100;
const NONE: readonly never[] = [];

export interface FaceProps {
  readonly controls: TileControls;
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** A round button on a tile that does its own job, above the button that opens the popover. */
function Action({ icon, label, onClick, tone, disabled }: { readonly icon: "play" | "pause" | "video"; readonly label: string; readonly onClick: () => void; readonly tone?: "urgent" | undefined; readonly disabled?: boolean | undefined }) {
  return (
    <button type="button" className="tile__action" aria-label={label} data-tone={tone} disabled={disabled} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

/** Words for a feed that has not arrived or has nothing to give; empty while it is still on its way. */
function noData(read: FeedRead<unknown>): string {
  return read.state === "issue" ? issueText(read.issue) : "";
}

// Calendar day ---------------------------------------------------------------------------------------------------

export function AgendaFace({ controls }: FaceProps) {
  const read = readFeed(useFeed("agenda"));
  const events: readonly AgendaEvent[] = read.state === "ready" ? read.data.events : NONE;
  const now = useBoundary((at) => nextAgendaChange(events, at));
  const lead = summariseAgenda(events, now, 1);
  const next = lead.shown[0];
  const day = new Date(read.state === "ready" ? read.data.day : now).getDate();
  const title = next ? next.title : read.state === "ready" ? (lead.allDay[0]?.title ?? t("tile.agenda.none")) : noData(read);
  const when = next ? (next.startsAt <= now ? t("tile.agenda.live") : timeFormat.format(next.startsAt)) : lead.allDay[0] ? t("tile.agenda.allDay") : null;
  const sub = when !== null && lead.more > 0 ? `${when} · ${t("tile.agenda.more", { count: lead.more })}` : when;
  return (
    <TileShell id="agenda" label={[t("tile.agenda"), title, sub].filter((p) => p).join(", ")} state={read.state} controls={controls}>
      <Mark tone={next && next.startsAt <= now ? "accent" : undefined}>
        <span className="tile__digits">{day}</span>
      </Mark>
      <Words title={title} sub={sub} />
    </TileShell>
  );
}

// Next meeting ---------------------------------------------------------------------------------------------------

function joinMeeting(meeting: MeetingView): void {
  if (meeting.joinUrl !== null) void runTileCommand(tilesBackend().commands.joinMeeting(meeting.joinUrl));
}

export function MeetingFace({ controls }: FaceProps) {
  const read = readFeed(useFeed("meeting"));
  const meeting = read.state === "ready" ? read.data : null;
  const now = useBoundary((at) => (meeting ? nextCountdownChange(meeting, at) : null));
  const countdown = meeting ? meetingCountdown(meeting, now) : null;
  const title = meeting ? meeting.title : read.state === "ready" ? t("tile.meeting.none") : noData(read);
  const joinable = meeting !== null && meeting.joinUrl !== null && countdown?.phase !== "over";
  return (
    <TileShell id="meeting" label={[t("tile.meeting"), title, countdown?.text].filter((p) => p).join(", ")} state={read.state} controls={controls}>
      <Mark tone={countdown?.urgent ? "accent" : undefined}>
        <Icon name={meeting !== null && meeting.joinUrl !== null ? "video" : "calendar"} />
      </Mark>
      <Words title={title} sub={countdown?.text} urgent={countdown?.urgent} />
      {meeting && joinable ? <Action icon="video" label={meeting.service ? t("tile.meeting.joinWith", { service: meeting.service }) : t("tile.meeting.join")} tone={countdown?.urgent ? "urgent" : undefined} onClick={() => joinMeeting(meeting)} /> : null}
    </TileShell>
  );
}

// Focus timer ----------------------------------------------------------------------------------------------------

/** Starts the focus plan, replacing a countdown or stopwatch that is not running. */
export function startFocus(): void {
  const { timer, setMode, start } = useTimerStore.getState();
  if (timer.mode !== "pomodoro") setMode("pomodoro");
  start();
}

/**
 * Keeps the shared timer honest while it runs: advances it when a phase ends, and chimes once for the finish,
 * whichever window saw it first. The home screen's widget does the same; they agree through the stored state.
 */
function useSettleFocus(now: number): void {
  const timer = useTimerStore((s) => s.timer);
  const settle = useTimerStore((s) => s.settle);
  useEffect(() => {
    if (timer.mode !== "pomodoro" || timer.status !== "running") return;
    const left = remainingMs(timer, FOCUS_PLAN, now);
    if (left === null || left > 0) return;
    if (chimeReady() && claimChime(finishKey(timer))) playChime();
    settle(FOCUS_PLAN);
  }, [now, timer, settle]);
}

export function FocusFace({ controls }: FaceProps) {
  const timer = useTimerStore((s) => s.timer);
  const running = timer.mode === "pomodoro" && timer.status === "running";
  const now = useTicker(1000, running);
  useSettleFocus(now);
  const view = focusView(timer, FOCUS_PLAN, now);
  const text = formatDuration(view.remainingMs);
  const phase = t(`tile.focus.phase.${view.phase}`);
  const sub = `${phase} · ${view.session}/${view.sessions}`;
  const used = view.totalMs > 0 ? 1 - view.remainingMs / view.totalMs : 0;
  return (
    <TileShell id="focus" label={`${t("tile.focus")}, ${phase}, ${text}`} controls={controls}>
      <Mark>
        <DotRing fraction={view.status === "idle" ? 0 : used} />
        <span className="tile__ringvalue">{Math.ceil(view.remainingMs / MS_PER_MINUTE)}</span>
      </Mark>
      <Words title={text} sub={sub} />
      <Action
        icon={running ? "pause" : "play"}
        label={running ? t("tile.focus.pause") : view.status === "paused" ? t("tile.focus.resume") : t("tile.focus.start")}
        disabled={view.busy}
        onClick={() => (running ? useTimerStore.getState().pause() : startFocus())}
      />
    </TileShell>
  );
}

// Stopwatch ------------------------------------------------------------------------------------------------------

export function StopwatchFace({ controls }: FaceProps) {
  const read = readFeed(useFeed("stopwatch"));
  const view: StopwatchView | null = read.state === "ready" ? read.data : null;
  const now = useTicker(1000, view?.running === true);
  const text = stopwatchText(view ? stopwatchElapsed(view, now) : 0).clock;
  const sub = view && view.laps.length > 0 ? t("tile.stopwatch.lap.number", { number: view.laps.length }) : t("tile.stopwatch");
  const running = view?.running === true;
  return (
    <TileShell id="stopwatch" label={`${t("tile.stopwatch")}, ${text}`} state={read.state} controls={controls}>
      <Mark tone={running ? "accent" : undefined}>
        <Icon name="flag" />
      </Mark>
      <Words title={view ? text : noData(read)} sub={view ? sub : null} />
      {view ? (
        <Action icon={running ? "pause" : "play"} label={running ? t("tile.stopwatch.pause") : t("tile.stopwatch.start")} onClick={() => void runTileCommand(tilesBackend().commands.stopwatch(running ? "pause" : "start"))} />
      ) : null}
    </TileShell>
  );
}

// Hydration ------------------------------------------------------------------------------------------------------

export function HydrationFace({ controls }: FaceProps) {
  const read = readFeed(useFeed("hydration"));
  const view: HydrationView | null = read.state === "ready" ? read.data : null;
  const progress = view ? t("tile.hydration.of", { logged: formatVolume(view.loggedMl), goal: formatVolume(view.goalMl) }) : "";
  return (
    <TileShell id="hydration" label={[t("tile.hydration"), progress].filter((p) => p).join(", ")} state={read.state} controls={controls}>
      <GlassDots loggedMl={view?.loggedMl ?? 0} goalMl={view?.goalMl ?? 0} />
    </TileShell>
  );
}

// Reminders ------------------------------------------------------------------------------------------------------

export function RemindersFace({ controls }: FaceProps) {
  const items = useTodoStore((s) => s.items);
  const now = useBoundary((at) => nextMidnight(at));
  const view = useMemo(() => remindersView(items, new Date(now)), [items, now]);
  const lead = view.rows.find((r) => !r.done);
  const sub = view.overdue > 0 ? t("tile.reminders.overdue", { count: view.overdue }) : view.dueToday > 0 ? t("tile.reminders.today", { count: view.dueToday }) : view.open > 0 ? plural("tile.reminders.open", view.open) : null;
  return (
    <TileShell id="reminders" label={[t("tile.reminders"), lead?.text ?? t("tile.reminders.none"), sub].filter((p) => p).join(", ")} controls={controls}>
      <Mark tone={view.overdue > 0 ? "danger" : view.dueToday > 0 ? "accent" : undefined}>
        <span className="tile__digits">{view.open}</span>
      </Mark>
      <Words title={lead?.text ?? t("tile.reminders.none")} sub={sub} />
    </TileShell>
  );
}

// Progress -------------------------------------------------------------------------------------------------------

export function ProgressFace({ controls }: FaceProps) {
  const now = useBoundary((at) => at - (at % MS_PER_MINUTE) + MS_PER_MINUTE);
  const day = periodGrids(new Date(now)).day;
  return (
    <TileShell id="progress" label={`${t("tile.progress")}, ${t("tile.progress.day")} ${t("tile.progress.percent", { percent: day.percent })}`} controls={controls}>
      <Mark>
        <DotRing fraction={day.percent / PERCENT} />
      </Mark>
      <Words title={t("tile.progress.percent", { percent: day.percent })} sub={t("tile.progress.day")} />
    </TileShell>
  );
}

// Contacts -------------------------------------------------------------------------------------------------------

export function ContactsFace({ controls }: FaceProps) {
  const read = readFeed(useFeed("contacts"));
  const view: ContactsView | null = read.state === "ready" ? read.data : null;
  const row = avatarRow(view?.contacts ?? NONE);
  const empty = view !== null && view.contacts.length === 0;
  return (
    <TileShell id="contacts" label={t("tile.contacts")} state={read.state} controls={controls}>
      {row.shown.length > 0 ? (
        <span className="avatars" aria-hidden="true">
          {row.shown.map((contact) => (
            <span key={contact.id} className="avatar">
              {initials(contact.name)}
            </span>
          ))}
          {row.more > 0 ? <span className="avatar avatar--more">+{row.more}</span> : null}
        </span>
      ) : (
        <>
          <Mark tone="dim">
            <Icon name="phone" />
          </Mark>
          <Words title={t("tile.contacts")} sub={empty ? t("tile.contacts.empty") : noData(read)} />
        </>
      )}
    </TileShell>
  );
}

// Microphone -----------------------------------------------------------------------------------------------------

/** The live input level, read from the core only while the tile can show it: on the dock, unmuted and awake. */
function useMicLevel(active: boolean): number {
  const awake = useAwake();
  const [level, setLevel] = useState(0);
  const listening = active && awake;
  useEffect(() => {
    if (!listening) {
      setLevel(0);
      return undefined;
    }
    return tilesBackend().watchMicLevel(setLevel);
  }, [listening]);
  return level;
}

export function MicFace() {
  const read = readFeed(useFeed("mic"));
  const view: MicView | null = read.state === "ready" ? read.data : null;
  const level = useMicLevel(view !== null && !view.muted);
  const muted = view?.muted === true;
  const label = muted ? t("tile.mic.unmute") : t("tile.mic.mute");
  return (
    <TileShell id="mic" label={view ? `${t("tile.mic")}, ${muted ? t("tile.mic.muted") : t("tile.mic.live")}` : t("tile.mic")} state={read.state}>
      <button
        type="button"
        className="tile__hit tile__hit--act"
        aria-label={label}
        aria-pressed={muted}
        disabled={view === null}
        title={read.state === "issue" ? issueText(read.issue) : undefined}
        onClick={() => void runTileCommand(tilesBackend().commands.toggleMic())}
      />
      <span className="tile__ringed" data-tone={muted ? "danger" : undefined}>
        <DotRing fraction={muted ? 0 : level} tone="var(--accent)" />
        <Icon name={muted ? "mic-off" : "mic"} />
      </span>
    </TileShell>
  );
}

// Sound ----------------------------------------------------------------------------------------------------------

export function AudioFace({ controls }: FaceProps) {
  const read = readFeed(useFeed("audio"));
  const view: AudioView | null = read.state === "ready" ? read.data : null;
  const silent = view === null || view.muted || view.volume <= 0;
  const percent = view ? Math.round(view.volume * PERCENT) : 0;
  return (
    <TileShell id="audio" label={view ? `${t("tile.audio")}, ${view.muted ? t("tile.audio.mute") : t("tile.audio.percent", { percent })}` : t("tile.audio")} state={read.state} controls={controls}>
      <span className="tile__ringed">
        <DotRing fraction={view && !view.muted ? view.volume : 0} />
        <Icon name={silent ? "volume-off" : "volume"} />
      </span>
    </TileShell>
  );
}

// System ---------------------------------------------------------------------------------------------------------

export function SystemFace({ controls }: FaceProps) {
  useRecordSystemLoad();
  const { data } = useProvider("system");
  const used = data && data.memTotalBytes > 0 ? data.memUsedBytes / data.memTotalBytes : null;
  const percent = used === null ? null : Math.round(used * PERCENT);
  return (
    <TileShell id="system" label={percent === null ? t("tile.system") : `${t("tile.system.memory")} ${percent}%`} controls={controls}>
      <DotRing fraction={used ?? 0} />
      <span className="system__value">{percent === null ? "–" : percent}</span>
    </TileShell>
  );
}
