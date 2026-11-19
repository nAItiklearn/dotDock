import { useEffect, useMemo, type ReactNode } from "react";
import { DotMatrix } from "../design-system/DotMatrix";
import { Caps, DotMeter, IconButton, Ring, Surface } from "../design-system/primitives";
import { useNow } from "../providers/clock";
import { playChime, primeChime } from "./chime";
import type { ConfigSchema } from "./configSchema";
import { defineWidget, type WidgetProps } from "./definition";
import { formatDuration, MS_PER_MINUTE } from "./format";
import { sizeSpec, type SizeId, type SizeSpec } from "./sizes";
import {
  COUNTDOWN_STEP_MS,
  elapsedMs,
  finishedRecently,
  progress,
  remainingMs,
  type PomodoroPlan,
  type TimerMode,
  type TimerState,
} from "./timerModel";
import { useTimerStore } from "./timerStore";
import "./TimerWidget.css";

export interface TimerConfig {
  readonly focusMinutes: number;
  readonly shortBreakMinutes: number;
  readonly longBreakMinutes: number;
  readonly sessionsBeforeLongBreak: number;
  readonly sound: boolean;
}

const TIMER_SIZES: readonly SizeSpec[] = [
  { id: "m", name: "Card", w: 4, h: 2 },
  { id: "s", name: "Dial", w: 2, h: 2 },
];

const TIMER_SCHEMA: ConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    focusMinutes: { type: "number", title: "Focus session", default: 25, minimum: 5, maximum: 90, multipleOf: 5, unit: "min" },
    shortBreakMinutes: { type: "number", title: "Short break", default: 5, minimum: 1, maximum: 30, multipleOf: 1, unit: "min" },
    longBreakMinutes: { type: "number", title: "Long break", default: 15, minimum: 5, maximum: 60, multipleOf: 5, unit: "min" },
    sessionsBeforeLongBreak: {
      type: "number",
      title: "Sessions before a long break",
      default: 4,
      minimum: 2,
      maximum: 8,
      multipleOf: 1,
    },
    sound: { type: "boolean", title: "Play a chime when time is up", default: true },
  },
};

const DEFAULT_CONFIG: TimerConfig = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  sessionsBeforeLongBreak: 4,
  sound: true,
};

/** A finish counts as "just now" for this long; after a restart the chime stays quiet. */
const CHIME_WINDOW_MS = 3000;
const CARD_DIGITS = 46;
const DIAL_DIGITS = 30;
const PROGRESS_DOTS = 30;
const PROGRESS_DOT = { dot: 5, gap: 4 } as const;

const MODES: readonly { readonly id: TimerMode; readonly label: string }[] = [
  { id: "countdown", label: "Timer" },
  { id: "stopwatch", label: "Stopwatch" },
  { id: "pomodoro", label: "Pomodoro" },
];

const PHASE_LABEL = { focus: "Focus", short: "Short break", long: "Long break" } as const;

function planOf(config: TimerConfig): PomodoroPlan {
  return {
    focusMs: config.focusMinutes * MS_PER_MINUTE,
    shortBreakMs: config.shortBreakMinutes * MS_PER_MINUTE,
    longBreakMs: config.longBreakMinutes * MS_PER_MINUTE,
    sessionsBeforeLongBreak: config.sessionsBeforeLongBreak,
  };
}

function useController(config: TimerConfig) {
  const { timer, start, pause, reset } = useTimerStore();
  const plan = useMemo(() => planOf(config), [config]);
  const toggle = (): void => {
    if (timer.status === "running") {
      pause();
      return;
    }
    if (config.sound) primeChime();
    if (timer.status === "done") reset();
    else start();
  };
  return { timer, plan, toggle, reset };
}

/** Re-renders each second and settles the timer when its time is up. Only mounted while running. */
function Ticking({ timer, plan, sound, children }: { readonly timer: TimerState; readonly plan: PomodoroPlan; readonly sound: boolean; readonly children: (now: number) => ReactNode }) {
  const now = useNow().getTime();
  const settle = useTimerStore((s) => s.settle);
  useEffect(() => {
    const left = remainingMs(timer, plan, now);
    if (left === null || left > 0) return;
    if (sound && finishedRecently(timer, plan, now, CHIME_WINDOW_MS)) playChime();
    settle(plan);
  }, [now, timer, plan, sound, settle]);
  return <>{children(now)}</>;
}

/** The clock face text: time left for timers, time run for the stopwatch. */
function readout(timer: TimerState, plan: PomodoroPlan, now: number): string {
  const left = remainingMs(timer, plan, now);
  return formatDuration(left ?? elapsedMs(timer, now));
}

const STATUS_LABEL = { idle: "Ready", running: "Running", paused: "Paused", done: "Time is up" } as const;

/** Phase for a Pomodoro, otherwise the plain status. */
function stateCaption(timer: TimerState): string {
  return timer.mode === "pomodoro" && timer.status !== "done" ? PHASE_LABEL[timer.phase] : STATUS_LABEL[timer.status];
}

function Dial({ config }: { readonly config: TimerConfig }) {
  const { timer, plan, toggle, reset } = useController(config);
  const spec = sizeSpec(TIMER_SIZES, "s");
  const view = (now: number): ReactNode => {
    const text = readout(timer, plan, now);
    return (
      <Surface shape="circle" w={spec.w} h={spec.h} label={`${stateCaption(timer)} ${text}`}>
        <Ring value={progress(timer, plan, now)} tone={timer.status === "done" ? "danger" : "accent"}>
          <button
            type="button"
            className="timer__face"
            aria-label={timer.status === "running" ? "Pause" : timer.status === "done" ? "Reset" : "Start"}
            onClick={toggle}
          >
            <Caps accent={timer.status === "running"}>{MODES.find((m) => m.id === timer.mode)?.label}</Caps>
            <DotMatrix text={text} matrixStyle="blocks" height={DIAL_DIGITS} label={text} />
            <Caps>{timer.status === "idle" ? "Tap to start" : stateCaption(timer)}</Caps>
          </button>
        </Ring>
        {timer.status === "paused" ? (
          <div className="timer__dial-reset">
            <IconButton icon="reset" label="Reset" tone="ghost" size="sm" onClick={reset} />
          </div>
        ) : null}
      </Surface>
    );
  };
  return timer.status === "running" ? (
    <Ticking timer={timer} plan={plan} sound={config.sound}>
      {view}
    </Ticking>
  ) : (
    view(Date.now())
  );
}

function SessionDots({ done, total }: { readonly done: number; readonly total: number }) {
  return (
    <span className="timer__sessions" role="img" aria-label={`${done} of ${total} focus sessions finished`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`timer__session${i < done ? " timer__session--done" : ""}`} />
      ))}
    </span>
  );
}

function Card({ config }: { readonly config: TimerConfig }) {
  const { timer, plan, toggle, reset } = useController(config);
  const setMode = useTimerStore((s) => s.setMode);
  const adjust = useTimerStore((s) => s.adjust);
  const skipPhase = useTimerStore((s) => s.skipPhase);
  const spec = sizeSpec(TIMER_SIZES, "m");
  const adjustable = timer.mode === "countdown" && (timer.status === "idle" || timer.status === "done");
  const view = (now: number): ReactNode => {
    const text = readout(timer, plan, now);
    return (
      <Surface shape="card" w={spec.w} h={spec.h} label={`${stateCaption(timer)} ${text}`}>
        <div className="timer">
          <div className="timer__modes" role="tablist" aria-label="Timer mode">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={timer.mode === m.id}
                className={`timer__mode${timer.mode === m.id ? " timer__mode--active" : ""}`}
                onClick={() => setMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="timer__main">
            <div className="timer__readout">
              <DotMatrix text={text} matrixStyle="blocks" height={CARD_DIGITS} label={text} />
              <DotMeter
                value={progress(timer, plan, now)}
                count={PROGRESS_DOTS}
                dot={PROGRESS_DOT.dot}
                gap={PROGRESS_DOT.gap}
                tone={timer.status === "done" ? "danger" : "accent"}
              />
            </div>
            <div className="timer__controls">
              {adjustable ? (
                <IconButton icon="minus" label="Shorter" tone="ghost" size="sm" onClick={() => adjust(-COUNTDOWN_STEP_MS)} />
              ) : null}
              <IconButton
                icon={timer.status === "running" ? "pause" : timer.status === "done" ? "reset" : "play"}
                label={timer.status === "running" ? "Pause" : timer.status === "done" ? "Reset" : "Start"}
                tone="accent"
                size="lg"
                onClick={toggle}
              />
              {adjustable ? (
                <IconButton icon="plus" label="Longer" tone="ghost" size="sm" onClick={() => adjust(COUNTDOWN_STEP_MS)} />
              ) : (
                <IconButton
                  icon="reset"
                  label="Reset"
                  tone="ghost"
                  size="sm"
                  disabled={timer.status === "idle"}
                  onClick={reset}
                />
              )}
            </div>
          </div>
          <div className="timer__foot">
            <Caps accent={timer.status === "running"}>{stateCaption(timer)}</Caps>
            {timer.mode === "pomodoro" ? (
              <span className="timer__pomodoro">
                <SessionDots done={timer.focusDone} total={config.sessionsBeforeLongBreak} />
                <button type="button" className="timer__skip" onClick={() => skipPhase(plan)}>
                  <Caps>Skip</Caps>
                </button>
              </span>
            ) : null}
          </div>
        </div>
      </Surface>
    );
  };
  return timer.status === "running" ? (
    <Ticking timer={timer} plan={plan} sound={config.sound}>
      {view}
    </Ticking>
  ) : (
    view(Date.now())
  );
}

export function TimerWidget({ size = "m", config = DEFAULT_CONFIG }: { readonly size?: SizeId; readonly config?: TimerConfig }) {
  return size === "s" ? <Dial config={config} /> : <Card config={config} />;
}

export const timerWidget = defineWidget<TimerConfig>({
  id: "timer",
  name: "Timer",
  description: "Countdown, stopwatch and Pomodoro. Keeps counting through restarts.",
  category: "productivity",
  sizes: TIMER_SIZES,
  providers: [],
  defaultConfig: DEFAULT_CONFIG,
  settingsSchema: TIMER_SCHEMA,
  component: ({ config, size }: WidgetProps<TimerConfig>) => <TimerWidget size={size} config={config} />,
});
