/**
 * Mean lunar nodes (Rahu / Ketu) — Epic 1.3.
 *
 * METHOD: mean ascending node from Meeus, "Astronomical Algorithms" ch. 47.7
 * (standard published reference; traditional Vedic practice uses the MEAN node).
 *   Ω = 125.0445479° − 1934.1362891°·T + 0.0020754°·T² + T³/467441
 * where T = Julian centuries from J2000 (TT).
 * Ketu = Rahu + 180°.
 */
const J2000_JD = 2451545.0;

function julianCenturies(date: Date): number {
  const jd = date.getTime() / 86400000 + 2440587.5;
  return (jd - J2000_JD) / 36525;
}

export function rahuMeanLon(date: Date): number {
  const T = julianCenturies(date);
  const omega = 125.0445479 - 1934.1362891 * T + 0.0020754 * T * T - (T * T * T) / 467441;
  return ((omega % 360) + 360) % 360;
}

export function ketuMeanLon(date: Date): number {
  return (((rahuMeanLon(date) + 180) % 360) + 360) % 360;
}
