/**
 * Celestial body helpers — thin wrapper over astronomy-engine 2.1.x (MIT, D5).
 * All longitudes are ecliptic-of-date, normalised 0–360°.
 * Sidereal = tropical − Lahiri ayanamsha.
 */
import * as Astronomy from "astronomy-engine";
import { toSidereal } from "./ayanamsha";

/** Apparent geocentric tropical longitude of the Sun (ecliptic of date). */
export function sunTropicalLon(date: Date): number {
  return Astronomy.SunPosition(date).elon;
}

/** Apparent geocentric tropical longitude of the Moon (ecliptic of date). */
export function moonTropicalLon(date: Date): number {
  return Astronomy.EclipticGeoMoon(date).lon;
}

export function sunSiderealLon(date: Date): number {
  return toSidereal(sunTropicalLon(date), date);
}

export function moonSiderealLon(date: Date): number {
  return toSidereal(moonTropicalLon(date), date);
}

/** Geocentric tropical longitude of Saturn (ecliptic of date) — Epic 1.10. */
function saturnTropicalLon(date: Date): number {
  const vec = Astronomy.GeoVector(Astronomy.Body.Saturn, Astronomy.MakeTime(date), true);
  return Astronomy.Ecliptic(vec).elon;
}

/** Sidereal longitude of Saturn (Lahiri) — drives Sade Sati transits. */
export function saturnSiderealLon(date: Date): number {
  return toSidereal(saturnTropicalLon(date), date);
}

/** Moon–Sun elongation (tropical, normalised 0–360) — drives tithi/karana. */
export function elongation(date: Date): number {
  const d = moonTropicalLon(date) - sunTropicalLon(date);
  return ((d % 360) + 360) % 360;
}

/** (sunSidereal + moonSidereal) mod 360 — drives yogas. */
export function sunMoonSumSidereal(date: Date): number {
  const s = sunSiderealLon(date) + moonSiderealLon(date);
  return ((s % 360) + 360) % 360;
}

export interface RiseSet {
  rise: Date | null;
  set: Date | null;
}

/** direction: +1 = rise, −1 = set (astronomy-engine 2.1.x convention). */
function searchBody(
  body: Astronomy.Body,
  direction: 1 | -1,
  start: Date,
  lat: number,
  lng: number,
): Date | null {
  const observer = new Astronomy.Observer(lat, lng, 0);
  const hit = Astronomy.SearchRiseSet(body, observer, direction, start, 1.5);
  return hit?.date ?? null;
}

/** Sunrise/sunset searching forward from `start` (≈ the local day start). */
export function sunRiseSet(start: Date, lat: number, lng: number): RiseSet {
  return {
    rise: searchBody(Astronomy.Body.Sun, 1, start, lat, lng),
    set: searchBody(Astronomy.Body.Sun, -1, start, lat, lng),
  };
}

/** Moonrise/moonset searching forward from `start`. */
export function moonRiseSet(start: Date, lat: number, lng: number): RiseSet {
  return {
    rise: searchBody(Astronomy.Body.Moon, 1, start, lat, lng),
    set: searchBody(Astronomy.Body.Moon, -1, start, lat, lng),
  };
}
