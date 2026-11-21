/**
 * Mean lunar nodes (Rahu / Ketu) — Epic 1.3, made sidereal in Epic 14 (QB-02).
 *
 * METHOD: mean ascending node from Meeus, "Astronomical Algorithms" ch. 47.7
 * (standard published reference; traditional Vedic practice uses the MEAN node).
 *   Ω = 125.0445479° − 1934.1362891°·T + 0.0020754°·T² + T³/467441
 * where T = Julian centuries from J2000 (TT).
 * Ketu = Rahu + 180°.
 *
 * The Meeus Ω is a TROPICAL longitude. Chart positions are sidereal
 * (Lahiri), so every consumer must use the *SiderealLon variants below —
 * the engine previously fed the tropical value straight into charts,
 * shifting Rahu/Ketu by the full ayanamsha (≈24.2°).
 */
import { toSidereal } from "./ayanamsha";

const J2000_JD = 2451545.0;

function julianCenturies(date: Date): number {
  const jd = date.getTime() / 86400000 + 2440587.5;
  return (jd - J2000_JD) / 36525;
}

/** Mean ascending node, TROPICAL longitude (Meeus 47.7). */
export function rahuMeanLon(date: Date): number {
  const T = julianCenturies(date);
  const omega = 125.0445479 - 1934.1362891 * T + 0.0020754 * T * T - (T * T * T) / 467441;
  return ((omega % 360) + 360) % 360;
}

/** Mean ascending node, SIDEREAL (Lahiri) longitude — use for chart positions. */
export function rahuSiderealLon(date: Date): number {
  return toSidereal(rahuMeanLon(date), date);
}

/** Mean descending node, SIDEREAL (Lahiri) longitude. */
export function ketuSiderealLon(date: Date): number {
  return (((rahuSiderealLon(date) + 180) % 360) + 360) % 360;
}
