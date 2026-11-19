import { DotMatrix } from "../design-system/DotMatrix";
import type { MatrixStyle } from "../design-system/matrixGeometry";
import { Caps } from "../design-system/primitives";
import { useMinute, useNow } from "../providers/clock";
import "./ClockWidget.css";

export interface ClockConfig {
  readonly matrixStyle: MatrixStyle;
  readonly hour24: boolean;
  readonly showSeconds: boolean;
  readonly blinkColon: boolean;
  /** Pixel height of the digits. */
  readonly height: number;
}

const pad = (n: number): string => n.toString().padStart(2, "0");

function timeText(d: Date, hour24: boolean): string {
  const h = d.getHours();
  const shown = hour24 ? h : h % 12 || 12;
  return `${pad(shown)}:${pad(d.getMinutes())}`;
}

function Seconds() {
  const now = useNow();
  return <span className="clock__seconds tabular">{pad(now.getSeconds())}</span>;
}

/** Large display clock that sits directly on the wallpaper. */
export function ClockWidget({ config }: { readonly config: ClockConfig }) {
  const minute = useMinute();
  const text = timeText(minute, config.hour24);
  const weekday = minute.toLocaleDateString(undefined, { weekday: "long" });
  return (
    <div className={`clock clock--${config.matrixStyle}${config.blinkColon ? " clock--blink" : ""}`}>
      <DotMatrix
        className="clock__digits"
        text={text}
        matrixStyle={config.matrixStyle}
        height={config.height}
        label={minute.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: !config.hour24 })}
      />
      <div className="clock__meta">
        <span className="clock__dot" aria-hidden="true" />
        <Caps>{weekday}</Caps>
        {config.showSeconds ? <Seconds /> : null}
      </div>
    </div>
  );
}
