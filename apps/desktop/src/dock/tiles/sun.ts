import { CITIES, type City } from "../../widgets/data/cities";

/**
 * Sunrise and sunset from the sunrise equation (the NOAA simplification), for a place and the solar day around a
 * moment. Accurate to a minute or two away from the poles, which is what a dock tile needs. Nothing is fetched: the
 * place is a bundled city and the time is the device's clock.
 */

const MS_PER_DAY = 86_400_000;
/** Julian date of the Unix epoch, and of the J2000 epoch the equation counts from. */
const JD_UNIX_EPOCH = 2_440_587.5;
const JD_J2000 = 2_451_545;
/** Leap seconds and the TT/UT difference, folded into the day count as the equation prescribes. */
const DAY_FUDGE = 0.0008;
const DEG = Math.PI / 180;
const FULL_TURN = 360;
/** Mean anomaly of the sun at J2000, and its daily motion, in degrees. */
const ANOMALY_AT_J2000 = 357.5291;
const ANOMALY_PER_DAY = 0.98560028;
/** Equation of the centre, the sun's argument of perihelion and the earth's tilt, in degrees. */
const CENTRE = [1.9148, 0.02, 0.0003] as const;
const PERIHELION = 102.9372;
const HALF_TURN = 180;
const TILT = 23.4397;
/** The sun is up while its centre is above this altitude: refraction and the sun's own radius. */
const HORIZON = -0.833;
/** Terms of the equation of time in the transit, in days. */
const TRANSIT_ANOMALY = 0.0053;
const TRANSIT_LONGITUDE = 0.0069;

const jd = (ms: number): number => ms / MS_PER_DAY + JD_UNIX_EPOCH;
const msOf = (julian: number): number => (julian - JD_UNIX_EPOCH) * MS_PER_DAY;
const wrap = (deg: number): number => ((deg % FULL_TURN) + FULL_TURN) % FULL_TURN;

export type SunDay =
  /** The sun rises and sets. */
  | { readonly kind: "day"; readonly sunrise: number; readonly sunset: number; readonly noon: number }
  /** It never rises (polar night) or never sets (midnight sun) on this day. */
  | { readonly kind: "night"; readonly noon: number }
  | { readonly kind: "midnight-sun"; readonly noon: number };

/** The sun's day at `lat`, `lon` (degrees, east positive) whose solar noon is nearest to `at`. */
export function sunDay(at: number, lat: number, lon: number): SunDay {
  const n = Math.round(jd(at) - JD_J2000 + DAY_FUDGE + lon / FULL_TURN);
  const meanNoon = n - lon / FULL_TURN;
  const anomaly = wrap(ANOMALY_AT_J2000 + ANOMALY_PER_DAY * meanNoon);
  const m = anomaly * DEG;
  const centre = CENTRE[0] * Math.sin(m) + CENTRE[1] * Math.sin(2 * m) + CENTRE[2] * Math.sin(3 * m);
  const longitude = wrap(anomaly + centre + HALF_TURN + PERIHELION) * DEG;
  const transit = JD_J2000 + meanNoon + TRANSIT_ANOMALY * Math.sin(m) - TRANSIT_LONGITUDE * Math.sin(2 * longitude);
  const declination = Math.asin(Math.sin(longitude) * Math.sin(TILT * DEG));
  const phi = lat * DEG;
  const cosHour = (Math.sin(HORIZON * DEG) - Math.sin(phi) * Math.sin(declination)) / (Math.cos(phi) * Math.cos(declination));
  const noon = msOf(transit);
  if (cosHour > 1) return { kind: "night", noon };
  if (cosHour < -1) return { kind: "midnight-sun", noon };
  const half = Math.acos(cosHour) / DEG / FULL_TURN;
  return { kind: "day", sunrise: msOf(transit - half), sunset: msOf(transit + half), noon };
}

/** Where the sun is on its arc: 0 at sunrise, 1 at sunset, and outside that range at night. */
export function arcFraction(at: number, day: SunDay): number {
  if (day.kind === "midnight-sun") return 0.5;
  if (day.kind === "night") return -1;
  return (at - day.sunrise) / (day.sunset - day.sunrise);
}

/** A point on the half-circle arc of radius 1 centred at the origin, y up: (-1, 0) at sunrise, (1, 0) at sunset. */
export function arcPoint(fraction: number): { readonly x: number; readonly y: number } {
  const clamped = Math.min(1, Math.max(0, fraction));
  const angle = Math.PI * (1 - clamped);
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/** The next sunrise or sunset after `at`, which is what the tile shows. */
export function nextEvent(at: number, lat: number, lon: number): { readonly kind: "sunrise" | "sunset"; readonly at: number } | null {
  for (let offset = 0; offset <= 2; offset += 1) {
    const day = sunDay(at + offset * MS_PER_DAY, lat, lon);
    if (day.kind !== "day") continue;
    if (day.sunrise > at) return { kind: "sunrise", at: day.sunrise };
    if (day.sunset > at) return { kind: "sunset", at: day.sunset };
  }
  return null;
}

/** The bundled city in the device's own time zone, which is where the user most likely is; null when there is none. */
export function homeCity(timeZone: string): City | null {
  return CITIES.find((c) => c.timeZone === timeZone) ?? null;
}

export const deviceTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
