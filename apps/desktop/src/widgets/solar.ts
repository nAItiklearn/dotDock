/**
 * Sun position from the low-precision algorithm in the Astronomical Almanac
 * (accurate to about 0.01 degrees, far more than a day/night dot needs).
 */
const DEG = Math.PI / 180;
const UNIX_EPOCH_JD = 2440587.5;
const J2000_JD = 2451545.0;
const MS_PER_DAY = 86_400_000;

/** The sun counts as risen when its centre is this far below the horizon (refraction plus its radius). */
const SUNRISE_ELEVATION = -0.833;

const wrap = (value: number, period: number): number => ((value % period) + period) % period;

/** Elevation of the sun above the horizon, in degrees, for a place and an instant. */
export function solarElevation(date: Date, lat: number, lon: number): number {
  const n = date.getTime() / MS_PER_DAY + UNIX_EPOCH_JD - J2000_JD;
  const meanLongitude = wrap(280.46 + 0.9856474 * n, 360);
  const meanAnomaly = wrap(357.528 + 0.9856003 * n, 360) * DEG;
  const eclipticLongitude = (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * DEG;
  const obliquity = (23.439 - 0.0000004 * n) * DEG;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude));
  const siderealDegrees = wrap(18.697374558 + 24.06570982441908 * n, 24) * 15;
  const hourAngle = (siderealDegrees + lon) * DEG - rightAscension;
  const sinElevation =
    Math.sin(lat * DEG) * Math.sin(declination) + Math.cos(lat * DEG) * Math.cos(declination) * Math.cos(hourAngle);
  return Math.asin(sinElevation) / DEG;
}

export function isDaylight(date: Date, lat: number, lon: number): boolean {
  return solarElevation(date, lat, lon) > SUNRISE_ELEVATION;
}

const DAY_START_HOUR = 6;
const DAY_END_HOUR = 18;

/** Fallback when a place has no coordinates: daytime is 06:00 to 18:00 local. */
export function isDaylightByHour(hour: number): boolean {
  return hour >= DAY_START_HOUR && hour < DAY_END_HOUR;
}
