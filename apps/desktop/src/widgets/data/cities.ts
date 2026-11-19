/**
 * Cities offered by the clock and world-clock widgets. Time zones are IANA ids, so offsets and
 * daylight saving come from the platform. Coordinates (degrees, two decimals) drive the day/night dot.
 */
export interface City {
  readonly id: string;
  readonly name: string;
  readonly timeZone: string;
  readonly lat: number;
  readonly lon: number;
}

export const CITIES: readonly City[] = [
  { id: "reykjavik", name: "Reykjavik", timeZone: "Atlantic/Reykjavik", lat: 64.15, lon: -21.94 },
  { id: "london", name: "London", timeZone: "Europe/London", lat: 51.51, lon: -0.13 },
  { id: "paris", name: "Paris", timeZone: "Europe/Paris", lat: 48.86, lon: 2.35 },
  { id: "amsterdam", name: "Amsterdam", timeZone: "Europe/Amsterdam", lat: 52.37, lon: 4.9 },
  { id: "berlin", name: "Berlin", timeZone: "Europe/Berlin", lat: 52.52, lon: 13.41 },
  { id: "madrid", name: "Madrid", timeZone: "Europe/Madrid", lat: 40.42, lon: -3.7 },
  { id: "rome", name: "Rome", timeZone: "Europe/Rome", lat: 41.9, lon: 12.5 },
  { id: "stockholm", name: "Stockholm", timeZone: "Europe/Stockholm", lat: 59.33, lon: 18.07 },
  { id: "athens", name: "Athens", timeZone: "Europe/Athens", lat: 37.98, lon: 23.73 },
  { id: "istanbul", name: "Istanbul", timeZone: "Europe/Istanbul", lat: 41.01, lon: 28.98 },
  { id: "moscow", name: "Moscow", timeZone: "Europe/Moscow", lat: 55.76, lon: 37.62 },
  { id: "cairo", name: "Cairo", timeZone: "Africa/Cairo", lat: 30.04, lon: 31.24 },
  { id: "lagos", name: "Lagos", timeZone: "Africa/Lagos", lat: 6.52, lon: 3.38 },
  { id: "nairobi", name: "Nairobi", timeZone: "Africa/Nairobi", lat: -1.29, lon: 36.82 },
  { id: "johannesburg", name: "Johannesburg", timeZone: "Africa/Johannesburg", lat: -26.2, lon: 28.05 },
  { id: "dubai", name: "Dubai", timeZone: "Asia/Dubai", lat: 25.2, lon: 55.27 },
  { id: "karachi", name: "Karachi", timeZone: "Asia/Karachi", lat: 24.86, lon: 67.01 },
  { id: "delhi", name: "Delhi", timeZone: "Asia/Kolkata", lat: 28.61, lon: 77.21 },
  { id: "mumbai", name: "Mumbai", timeZone: "Asia/Kolkata", lat: 19.08, lon: 72.88 },
  { id: "bengaluru", name: "Bengaluru", timeZone: "Asia/Kolkata", lat: 12.97, lon: 77.59 },
  { id: "dhaka", name: "Dhaka", timeZone: "Asia/Dhaka", lat: 23.81, lon: 90.41 },
  { id: "bangkok", name: "Bangkok", timeZone: "Asia/Bangkok", lat: 13.76, lon: 100.5 },
  { id: "singapore", name: "Singapore", timeZone: "Asia/Singapore", lat: 1.35, lon: 103.82 },
  { id: "jakarta", name: "Jakarta", timeZone: "Asia/Jakarta", lat: -6.21, lon: 106.85 },
  { id: "hong-kong", name: "Hong Kong", timeZone: "Asia/Hong_Kong", lat: 22.32, lon: 114.17 },
  { id: "shanghai", name: "Shanghai", timeZone: "Asia/Shanghai", lat: 31.23, lon: 121.47 },
  { id: "seoul", name: "Seoul", timeZone: "Asia/Seoul", lat: 37.57, lon: 126.98 },
  { id: "tokyo", name: "Tokyo", timeZone: "Asia/Tokyo", lat: 35.68, lon: 139.69 },
  { id: "sydney", name: "Sydney", timeZone: "Australia/Sydney", lat: -33.87, lon: 151.21 },
  { id: "auckland", name: "Auckland", timeZone: "Pacific/Auckland", lat: -36.85, lon: 174.76 },
  { id: "honolulu", name: "Honolulu", timeZone: "Pacific/Honolulu", lat: 21.31, lon: -157.86 },
  { id: "anchorage", name: "Anchorage", timeZone: "America/Anchorage", lat: 61.22, lon: -149.9 },
  { id: "los-angeles", name: "Los Angeles", timeZone: "America/Los_Angeles", lat: 34.05, lon: -118.24 },
  { id: "san-francisco", name: "San Francisco", timeZone: "America/Los_Angeles", lat: 37.77, lon: -122.42 },
  { id: "denver", name: "Denver", timeZone: "America/Denver", lat: 39.74, lon: -104.99 },
  { id: "mexico-city", name: "Mexico City", timeZone: "America/Mexico_City", lat: 19.43, lon: -99.13 },
  { id: "chicago", name: "Chicago", timeZone: "America/Chicago", lat: 41.88, lon: -87.63 },
  { id: "toronto", name: "Toronto", timeZone: "America/Toronto", lat: 43.65, lon: -79.38 },
  { id: "new-york", name: "New York", timeZone: "America/New_York", lat: 40.71, lon: -74.01 },
  { id: "bogota", name: "Bogota", timeZone: "America/Bogota", lat: 4.71, lon: -74.07 },
  { id: "lima", name: "Lima", timeZone: "America/Lima", lat: -12.05, lon: -77.04 },
  { id: "buenos-aires", name: "Buenos Aires", timeZone: "America/Argentina/Buenos_Aires", lat: -34.6, lon: -58.38 },
  { id: "sao-paulo", name: "Sao Paulo", timeZone: "America/Sao_Paulo", lat: -23.55, lon: -46.63 },
];

export function cityById(id: string): City | undefined {
  return CITIES.find((c) => c.id === id);
}
