/**
 * Kundli core (Epic 1.3): planetary positions, Lagna, whole-sign houses,
 * Navamsha (D9), sign/nakshatra mapping. Pure functions, deterministic.
 */
import * as Astronomy from "astronomy-engine";
import { ascendantSidereal } from "./ascendant";
import { lahiriAyanamsha } from "./ayanamsha";
import { moonSiderealLon, sunSiderealLon } from "./bodies";
import { NAKSHATRAS } from "./names";
import { ketuSiderealLon, rahuSiderealLon } from "./nodes";

const SIGNS = [
  "Aries",
  "Taurus",
  "Gemini",
  "Cancer",
  "Leo",
  "Virgo",
  "Libra",
  "Scorpio",
  "Sagittarius",
  "Capricorn",
  "Aquarius",
  "Pisces",
];
const NAKSHATRA_SPAN = 360 / 27;

export type PlanetName =
  | "Sun"
  | "Moon"
  | "Mars"
  | "Mercury"
  | "Jupiter"
  | "Venus"
  | "Saturn"
  | "Rahu"
  | "Ketu";

export interface PlanetPosition {
  planet: PlanetName;
  lon: number; // sidereal longitude 0–360
  sign: string; // rashi name
  signIndex: number; // 0..11 (Aries=0)
  nakshatra: string;
  nakshatraIndex: number; // 0..26
  pada: number; // 1..4
  retrograde: boolean;
}

export interface LagnaPosition {
  lon: number;
  sign: string;
  signIndex: number;
  nakshatra: string;
  nakshatraIndex: number;
  pada: number;
  house: 1;
}

export interface KundliInput {
  /** birth instant (UTC instant of the LOCAL birth date+time) */
  datetime: Date;
  latitude: number;
  longitude: number;
}

function geocentricLon(planet: Astronomy.Body, date: Date): number {
  const time = Astronomy.MakeTime(date);
  const vec = Astronomy.GeoVector(planet, time, true); // aberration-corrected
  const ecl = Astronomy.Ecliptic(vec);
  return ecl.elon;
}

function siderealBody(planet: Astronomy.Body, date: Date): number {
  const tropical = geocentricLon(planet, date);
  return (tropical - lahiriAyanamsha(date) + 360) % 360;
}

function isRetrograde(planet: Astronomy.Body, date: Date): boolean {
  const before = geocentricLon(planet, new Date(date.getTime() - 3600_000));
  const after = geocentricLon(planet, new Date(date.getTime() + 3600_000));
  let d = after - before;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d < 0;
}

export function signOf(lon: number): { sign: string; signIndex: number } {
  const idx = Math.floor((((lon % 360) + 360) % 360) / 30);
  return { sign: SIGNS[idx] ?? "Aries", signIndex: idx };
}

export function nakshatraOf(lon: number): {
  nakshatra: string;
  nakshatraIndex: number;
  pada: number;
} {
  const norm = ((lon % 360) + 360) % 360;
  const nIdx = Math.floor(norm / NAKSHATRA_SPAN);
  const within = norm - nIdx * NAKSHATRA_SPAN;
  const pada = Math.min(4, Math.floor(within / (NAKSHATRA_SPAN / 4)) + 1);
  return { nakshatra: NAKSHATRAS[nIdx] ?? "Ashwini", nakshatraIndex: nIdx, pada };
}

/** All nine grahas with sidereal positions for the birth instant. */
export function planetaryPositions(input: KundliInput): PlanetPosition[] {
  const { datetime } = input;
  const entries: Array<[PlanetName, number, boolean]> = [
    ["Sun", sunSiderealLon(datetime), false],
    ["Moon", moonSiderealLon(datetime), false],
    [
      "Mars",
      siderealBody(Astronomy.Body.Mars, datetime),
      isRetrograde(Astronomy.Body.Mars, datetime),
    ],
    [
      "Mercury",
      siderealBody(Astronomy.Body.Mercury, datetime),
      isRetrograde(Astronomy.Body.Mercury, datetime),
    ],
    [
      "Jupiter",
      siderealBody(Astronomy.Body.Jupiter, datetime),
      isRetrograde(Astronomy.Body.Jupiter, datetime),
    ],
    [
      "Venus",
      siderealBody(Astronomy.Body.Venus, datetime),
      isRetrograde(Astronomy.Body.Venus, datetime),
    ],
    [
      "Saturn",
      siderealBody(Astronomy.Body.Saturn, datetime),
      isRetrograde(Astronomy.Body.Saturn, datetime),
    ],
    ["Rahu", rahuSiderealLon(datetime), true],
    ["Ketu", ketuSiderealLon(datetime), true], // nodes are always retrograde
  ];

  return entries.map(([planet, lon, retrograde]) => {
    const sign = signOf(lon);
    const naks = nakshatraOf(lon);
    return { planet, lon: Math.round(lon * 1e4) / 1e4, ...sign, ...naks, retrograde };
  });
}

/** Lagna (sidereal ascendant) with sign + nakshatra context. */
export function lagna(input: KundliInput): LagnaPosition {
  const lon = ascendantSidereal(input.datetime, input.latitude, input.longitude);
  const sign = signOf(lon);
  const naks = nakshatraOf(lon);
  return { lon: Math.round(lon * 1e4) / 1e4, ...sign, ...naks, house: 1 };
}

/**
 * Whole-sign houses (Vedic standard): the Lagna's sign is house 1; each
 * subsequent sign is the next house. Returns planet → house (1..12).
 */
export function wholeSignHouses(
  positions: PlanetPosition[],
  lagnaLon: number,
): Record<string, number> {
  const lagnaSign = Math.floor((((lagnaLon % 360) + 360) % 360) / 30);
  const out: Record<string, number> = {};
  for (const p of positions) {
    const signIdx = Math.floor((((p.lon % 360) + 360) % 360) / 30);
    out[p.planet] = ((signIdx - lagnaSign + 12) % 12) + 1;
  }
  return out;
}

/**
 * Navamsha (D9) sign index for a longitude: each sign divides into 9 parts of
 * 3°20′; navamsha sign = (signIndex × 9 + part) mod 12 — this continuous
 * scheme reproduces the classical rule exactly (movable→self, fixed→9th from
 * self, dual→5th from self; verified in tests).
 */
export function navamshaSignIndex(lon: number): number {
  const norm = ((lon % 360) + 360) % 360;
  const signIdx = Math.floor(norm / 30);
  const part = Math.floor((norm - signIdx * 30) / (30 / 9)); // 0..8
  return (signIdx * 9 + part) % 12;
}

export { SIGNS };
