import { formatDuration, MS_PER_HOUR, MS_PER_MINUTE } from "../../widgets/format";
import { t } from "../strings";
import type { MeetingView, StopwatchView } from "./ui-types";

/** A meeting this close gets the accent: the Join button and countdown are what the user is about to need. */
export const URGENT_MS = 5 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_TENTH = 100;
const TENTHS_PER_SECOND = 10;

export type MeetingPhase = "upcoming" | "live" | "over";

export interface MeetingCountdown {
  readonly phase: MeetingPhase;
  /** "in 12 min", "in 1 h 05 min", "Now", "Ended". */
  readonly text: string;
  /** Starts within `URGENT_MS`, or is on right now. */
  readonly urgent: boolean;
}

/** How far away a meeting is, in the words people use. Minutes round up: at 11 min 30 s it still says 12. */
export function meetingCountdown(meeting: Pick<MeetingView, "startsAt" | "endsAt">, now: number): MeetingCountdown {
  if (now >= meeting.endsAt) return { phase: "over", text: t("tile.meeting.over"), urgent: false };
  if (now >= meeting.startsAt) return { phase: "live", text: t("tile.meeting.live"), urgent: true };
  const until = meeting.startsAt - now;
  const urgent = until <= URGENT_MS;
  if (until < MS_PER_MINUTE) return { phase: "upcoming", text: t("tile.meeting.seconds"), urgent };
  if (until < MS_PER_HOUR) return { phase: "upcoming", text: t("tile.meeting.minutes", { count: Math.ceil(until / MS_PER_MINUTE) }), urgent };
  if (until < MS_PER_DAY) {
    const total = Math.ceil(until / MS_PER_MINUTE);
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    return {
      phase: "upcoming",
      text: minutes === 0 ? t("tile.meeting.hours", { hours }) : t("tile.meeting.hoursMinutes", { hours, minutes: minutes.toString().padStart(2, "0") }),
      urgent,
    };
  }
  return { phase: "upcoming", text: t("tile.meeting.days", { count: Math.floor(until / MS_PER_DAY) }), urgent };
}

/**
 * The next moment the countdown's words change, in epoch ms, or null once the meeting is over. The tile sleeps
 * until then: it never polls, and the minute number turns on the minute it should.
 */
export function nextCountdownChange(meeting: Pick<MeetingView, "startsAt" | "endsAt">, now: number): number | null {
  if (now >= meeting.endsAt) return null;
  if (now >= meeting.startsAt) return meeting.endsAt;
  const until = meeting.startsAt - now;
  // Exactly one minute or one hour out the words are a different unit for that single instant: they change at once.
  if (until === MS_PER_MINUTE || until === MS_PER_HOUR) return now + 1;
  if (until < MS_PER_MINUTE) return meeting.startsAt;
  if (until < MS_PER_DAY) return meeting.startsAt - (Math.ceil(until / MS_PER_MINUTE) - 1) * MS_PER_MINUTE;
  return meeting.startsAt - Math.floor(until / MS_PER_DAY) * MS_PER_DAY + 1;
}

/** Time on the stopwatch at `now`. */
export function stopwatchElapsed(view: Pick<StopwatchView, "running" | "startedAt" | "bankedMs">, now: number): number {
  const live = view.running && view.startedAt !== null ? Math.max(0, now - view.startedAt) : 0;
  return view.bankedMs + live;
}

export interface StopwatchText {
  /** "04:07", or "1:04:07" from one hour up. */
  readonly clock: string;
  /** The tenth of a second, one digit. */
  readonly tenth: string;
}

export function stopwatchText(ms: number): StopwatchText {
  const whole = Math.max(0, Math.floor(ms));
  return { clock: formatDuration(whole), tenth: String(Math.floor(whole / MS_PER_TENTH) % TENTHS_PER_SECOND) };
}

export interface LapRow {
  /** 1-based. */
  readonly number: number;
  /** Time this lap took. */
  readonly splitMs: number;
  /** Stopwatch time at the end of the lap. */
  readonly totalMs: number;
  readonly mark: "fastest" | "slowest" | null;
}

/** Fewer laps than this have no meaningful fastest or slowest. */
const MIN_LAPS_FOR_MARKS = 3;

/** The laps as rows, newest first, with the fastest and slowest marked once there are enough to compare. */
export function lapRows(laps: readonly number[]): readonly LapRow[] {
  const splits = laps.map((total, i) => Math.max(0, total - (laps[i - 1] ?? 0)));
  const fastest = Math.min(...splits);
  const slowest = Math.max(...splits);
  const marked = laps.length >= MIN_LAPS_FOR_MARKS && fastest !== slowest;
  return laps
    .map((totalMs, i): LapRow => {
      const splitMs = splits[i] ?? 0;
      return { number: i + 1, splitMs, totalMs, mark: !marked ? null : splitMs === fastest ? "fastest" : splitMs === slowest ? "slowest" : null };
    })
    .reverse();
}

const ML_PER_LITRE = 1000;

/** "250 ml" below a litre, "1.2 L" from one up, in the user's number format. */
export function formatVolume(ml: number, locale?: string): string {
  const litres = ml >= ML_PER_LITRE;
  const format = new Intl.NumberFormat(locale, { style: "unit", unit: litres ? "liter" : "milliliter", unitDisplay: "short", maximumFractionDigits: litres ? 1 : 0 });
  return format.format(litres ? ml / ML_PER_LITRE : Math.round(ml));
}
