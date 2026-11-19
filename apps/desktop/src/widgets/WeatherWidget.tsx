import { DotMatrix } from "../design-system/DotMatrix";
import { Caps, Surface } from "../design-system/primitives";
import { useProvider } from "../providers/store";
import { WidgetNotice } from "./WidgetNotice";
import "./WeatherWidget.css";

const TEMP_HEIGHT = 30;

/** Short labels for WMO weather codes (Open-Meteo). */
function conditionFor(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code >= 95) return "Thunderstorm";
  return "Unknown";
}

/** M pill: current temperature, condition and today's range. */
export function WeatherWidget() {
  const { data, issue, stale } = useProvider("weather");
  return (
    <Surface shape="pill" w={3} h={1} label="Weather">
      {data ? (
        <div className={`weather${stale ? " weather--stale" : ""}`}>
          <DotMatrix
            text={`${Math.round(data.temperatureC)}°`}
            matrixStyle="dots"
            height={TEMP_HEIGHT}
            label={`${Math.round(data.temperatureC)} degrees`}
          />
          <div className="weather__text">
            <span className="weather__condition">{conditionFor(data.code)}</span>
            <Caps>
              {data.place} · {Math.round(data.highC)}° / {Math.round(data.lowC)}°
            </Caps>
          </div>
        </div>
      ) : (
        <WidgetNotice title="Weather" issue={issue} />
      )}
    </Surface>
  );
}
