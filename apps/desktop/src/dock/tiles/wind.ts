/** Wind from the weather provider: how fast, and where it comes from, as a compass point. */
const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"] as const;
export type CompassPoint = (typeof POINTS)[number];
const FULL_TURN = 360;

const normalise = (degrees: number): number => ((degrees % FULL_TURN) + FULL_TURN) % FULL_TURN;

/** The nearest of the 16 compass points to a bearing in degrees. */
export function compassPoint(degrees: number): CompassPoint {
  const step = FULL_TURN / POINTS.length;
  return POINTS[Math.round(normalise(degrees) / step) % POINTS.length] ?? "N";
}

/** The way the air moves, for the arrow: opposite to where it comes from. */
export const blowsToward = (fromDegrees: number): number => normalise(fromDegrees + FULL_TURN / 2);

/** Beaufort scale upper bounds in km/h, for force 0 to 11; anything above the last is force 12. */
const BEAUFORT_KMH = [1, 5, 11, 19, 28, 38, 49, 61, 74, 88, 102, 117] as const;

export function beaufort(kmh: number): number {
  const force = BEAUFORT_KMH.findIndex((limit) => kmh <= limit);
  return force === -1 ? BEAUFORT_KMH.length : force;
}
