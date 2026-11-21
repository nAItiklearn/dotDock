import { DotIcon } from "../../design-system/DotMatrix";
import { useProvider } from "../../providers/store";
import { defaultTemperatureUnit, displayTemperature } from "../../widgets/format";
import { conditionIcon, conditionLabel } from "../../widgets/weatherModel";
import { t } from "../strings";
import { Mark, TileShell, Words, issueText } from "./shell";

/** Size of the condition glyph in the tile's round mark, in px at the dock's base icon size. */
const GLYPH = 22;

/**
 * Weather now, from the same Open-Meteo feed as the home-screen weather widget: the condition as a dot glyph, the
 * temperature in the unit of the user's region, and the condition in words. The place, the day's range and the
 * condition are all in the label for screen readers.
 */
export function WeatherFace() {
  const { data, issue } = useProvider("weather");
  if (data === null) {
    const why = issue === null ? "" : issueText(issue);
    return (
      <TileShell id="weather" label={[t("tile.weather"), why].filter((p) => p).join(", ")} state={issue === null ? "pending" : "issue"}>
        <Mark tone="dim">
          <DotIcon name="cloudy" size={GLYPH} />
        </Mark>
        <Words title={why || t("tile.weather")} />
      </TileShell>
    );
  }
  const unit = defaultTemperatureUnit(navigator.language);
  const degrees = (c: number): string => t("tile.weather.degrees", { value: String(displayTemperature(c, unit)) });
  const condition = conditionLabel(data.code);
  const label = [t("tile.weather"), data.place, degrees(data.temperatureC), condition, t("tile.weather.range", { high: degrees(data.highC), low: degrees(data.lowC) })].join(", ");
  return (
    <TileShell id="weather" label={label}>
      <Mark>
        <DotIcon name={conditionIcon(data.code, data.isDay)} size={GLYPH} />
      </Mark>
      <Words title={degrees(data.temperatureC)} sub={condition} />
    </TileShell>
  );
}
