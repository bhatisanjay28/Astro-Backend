/**
 * Ascendant (Lagna) — Epic 1.3.
 *
 * METHOD (standard published spherical-astronomy formula):
 *   LST  = GST + longitude/15            (GST from astronomy-engine SiderealTime)
 *   RAMC = LST × 15°
 *   ASC  = atan2( cos(RAMC), −( sin(RAMC)·cos(ε) + tan(φ)·sin(ε) ) )
 *   ε    = mean obliquity (23.4392911° − 0.0130042°·T, J2000 linear term —
 *          sufficient arc-minute precision for 1900–2100)
 * Sidereal ASC = ASC_tropical − Lahiri ayanamsha.
 *
 * VALIDATION anchor: at the exact instant of sunrise the ascendant must equal
 * the Sun's tropical longitude (the Sun sits on the eastern horizon) — used in
 * tests across dates/locations.
 */
import * as Astronomy from "astronomy-engine";
import { lahiriAyanamsha } from "./ayanamsha";

/** Mean obliquity of the ecliptic (degrees), J2000 linear term. */
export function meanObliquity(date: Date): number {
  const T = (date.getTime() / 86400000 + 2440587.5 - 2451545.0) / 36525;
  return 23.4392911 - 0.0130042 * T;
}

/** Local apparent sidereal time in degrees. */
export function localSiderealTimeDeg(date: Date, longitudeEast: number): number {
  const gastHours = Astronomy.SiderealTime(Astronomy.MakeTime(date)); // Greenwich AST hours
  return ((((gastHours + longitudeEast / 15) % 24) + 24) % 24) * 15;
}

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Tropical ascendant longitude (degrees, 0–360). */
export function ascendantTropical(date: Date, latitude: number, longitudeEast: number): number {
  const ramc = localSiderealTimeDeg(date, longitudeEast); // deg
  const eps = meanObliquity(date);
  const sinR = Math.sin(ramc * RAD);
  const cosR = Math.cos(ramc * RAD);
  const tanPhi = Math.tan(latitude * RAD);
  const y = cosR;
  const x = -(sinR * Math.cos(eps * RAD) + tanPhi * Math.sin(eps * RAD));
  let asc = Math.atan2(y, x) * DEG;
  asc = ((asc % 360) + 360) % 360;
  return asc;
}

/** Sidereal ascendant longitude (degrees, 0–360) — the Lagna. */
export function ascendantSidereal(date: Date, latitude: number, longitudeEast: number): number {
  return (ascendantTropical(date, latitude, longitudeEast) - lahiriAyanamsha(date) + 360) % 360;
}
